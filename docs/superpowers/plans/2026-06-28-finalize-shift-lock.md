# Chống lệch lương khi chốt két (rule + advisory lock) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Serialize per-business_date các đường ghi lương ↔ chốt két bằng advisory lock (idiom `safe_fund:*` đã có) + rule "ra ca hết mới chốt" + final-close guard cho check-in → không lệch tiền + không ca kẹt.

**Architecture:** Thêm `pg_advisory_xact_lock(hashtext('cash_close:'||<date>::text))` vào 4 hàm (`finalize_cash_close_report`, `check_in_self`, `check_in_employee`, `edit_shift_payroll_record`); rule no-open-shift trong finalize; final-close guard cho 2 check-in. Dual-write 002 + migration. UI cash-view cảnh báo + disable nút Chốt. TDD qua pgTAP `360`.

**Tech Stack:** Postgres (Supabase local), pgTAP qua `tools/pgtap-local.mjs`, Next.js 15 / React 19 / TS.

**Spec:** `docs/superpowers/specs/2026-06-28-finalize-requires-closed-shifts-design.md` (v2, Codex-reviewed v1 → fold lock).

---

## Pre-flight
- [ ] Đang ở branch `feat/finalize-requires-closed-shifts` (đã có spec, off `origin/main` = v4.12.0). Tiếp tục.
- [ ] **Dual-write:** mỗi đổi SQL vào CẢ `database/002_functions.sql` VÀ migration `database/migrations/2026-06-28-finalize-shift-lock.sql` (tạo mới), byte-identical (full thân hàm).
- [ ] **pgTAP:** `node tools/pgtap-local.mjs --reset --all` (001+002+003+migrations; KHÔNG seed 004). KHÔNG `npm run build` khi 3009 chạy.
- [ ] **Idiom lock có sẵn:** `pg_advisory_xact_lock(hashtext('safe_fund:cash'))` (002:971…). Dùng namespace MỚI `'cash_close:'` — không trùng.

## File Structure
| File | Trách nhiệm | Loại |
|---|---|---|
| `database/tests/360_finalize_shift_lock.sql` | pgTAP: rule no-open-shift + check-in final-guard | Create |
| `database/002_functions.sql` | lock+rule finalize; lock+guard 2 check-in; lock edit | Modify |
| `database/migrations/2026-06-28-finalize-shift-lock.sql` | Dual-write full 4 hàm | Create |
| `src/features/cash/cash-view.tsx` | cảnh báo + disable nút Chốt khi còn ca mở | Modify |
| (regress) `database/tests/*.sql` | sửa fixture nếu final-rồi-checkin / open-shift-rồi-finalize | Modify |

---

## Task 1: pgTAP `360_finalize_shift_lock.sql` (đỏ trước)

**Files:** Create `database/tests/360_finalize_shift_lock.sql`

- [ ] **Step 1: Viết test**

Phần A (rule) tái dùng pattern `database/tests/040_finalize_cash_close_report.sql` (act_as owner → `save_cash_day_opening` → `save_cash_count` shift_close → `finalize_cash_close_report`). Phần B (check-in guard) tự đứng (INSERT final report).

```sql
-- 360 — Chống lệch lương khi chốt két: rule no-open-shift + final-close guard cho
-- check-in. (Advisory lock không test được contention trong 1 transaction — xem spec §5.)
begin;
select plan(6);

create or replace function pg_temp.act_as(p_user_id uuid)
returns void as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end; $$ language plpgsql;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('11111111-1111-1111-1111-111111111111','owner@t.local','',now(),'00000000-0000-0000-0000-000000000000'),
  ('22222222-2222-2222-2222-222222222222','self@t.local','',now(),'00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values ('11111111-1111-1111-1111-111111111111','Owner');
insert into public.employees (id, name, hourly_rate) values
  ('ee000000-0000-0000-0000-000000000001','NV',30000);
insert into public.employee_accounts (auth_user_id, employee_id, role, status) values
  ('11111111-1111-1111-1111-111111111111', null, 'owner','active'),
  ('22222222-2222-2222-2222-222222222222','ee000000-0000-0000-0000-000000000001','employee_self_service','active');

-- ===== Phần A — rule: finalize từ chối khi còn ca mở cùng business_date =====
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select public.save_cash_day_opening(jsonb_build_object(
  'business_date','2026-01-15','denominations_json',jsonb_build_object('100000',2),
  'carried_from_previous_day',false,'safe_withdrawal_amount',0));
create temp table _count as
  select ((public.save_cash_count(jsonb_build_object(
    'business_date','2026-01-15','denominations_json',jsonb_build_object('100000',10),
    'total_physical',1000000,'bank_transfer_confirmed',0,'count_type','shift_close',
    'pos_total',1000000,'pos_cash_total',1000000,'pos_non_cash_total',0)))->>'cash_count_id')::uuid as id;

-- Ca MỞ ngày 2026-01-15 → finalize phải raise.
insert into public.shift_assignments (id, employee_id, business_date, check_in_at, status, created_by, updated_by)
values ('5a000000-0000-0000-0000-0000000000a1','ee000000-0000-0000-0000-000000000001',
        '2026-01-15', '2026-01-15 08:00+07', 'checked_in',
        '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111');
-- 1
select throws_like(
  $$ select public.finalize_cash_close_report((select id from _count), 100000) $$,
  '%chưa ra ca%', 'finalize bị chặn khi còn ca mở cùng ngày (rule)');
-- 2: ca ngày KHÁC không chặn → đóng ca 2026-01-15 rồi finalize lives
update public.shift_assignments set status='checked_out', check_out_at='2026-01-15 17:00+07'
  where id='5a000000-0000-0000-0000-0000000000a1';
insert into public.shift_assignments (id, employee_id, business_date, check_in_at, status, created_by, updated_by)
values ('5a000000-0000-0000-0000-0000000000a2','ee000000-0000-0000-0000-000000000001',
        '2026-01-16', '2026-01-16 08:00+07', 'checked_in',
        '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111');
select lives_ok(
  $$ select public.finalize_cash_close_report((select id from _count), 100000) $$,
  'finalize OK khi ngày 2026-01-15 đã ra hết (ca ngày khác không chặn)');
-- 3
select is(
  (select report_status from public.cash_close_reports where business_date='2026-01-15'),
  'final', 'báo cáo 2026-01-15 = final');

-- ===== Phần B — final-close guard cho check-in (trên ngày đã chốt két) =====
-- Mở cổng giờ (throwaway không seed 004) để gate 05:30 không chặn.
insert into public.app_settings (key, value, is_public) values
  ('checkin_network','{"shift_start_time":"00:00"}'::jsonb,false)
  on conflict (key) do update set value = public.app_settings.value || excluded.value;
-- Tạo final report cho HÔM NAY (current_date) để test check_in_self (dùng current_date).
insert into public.cash_counts (id, business_date) values ('cc000000-0000-0000-0000-0000000000b1', current_date);
insert into public.cash_close_reports (business_date, cash_count_id, report_status)
  values (current_date, 'cc000000-0000-0000-0000-0000000000b1', 'final');
-- 4: check_in_self vào ngày đã final → raise
select throws_like(
  $$ select public.check_in_self('22222222-2222-2222-2222-222222222222'::uuid, null, null) $$,
  '%đã chốt két%', 'check_in_self bị chặn trên ngày đã chốt két');
-- 5: check_in_employee (owner) vào ngày đã final → raise
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select throws_like(
  $$ select public.check_in_employee(json_build_object(
       'employee_id','ee000000-0000-0000-0000-000000000001','business_date',current_date::text)::jsonb) $$,
  '%đã chốt két%', 'check_in_employee bị chặn trên ngày đã chốt két');
-- 6: ngày CHƯA final (mai) → check_in_employee lives
select lives_ok(
  $$ select public.check_in_employee(json_build_object(
       'employee_id','ee000000-0000-0000-0000-000000000001','business_date',(current_date+1)::text)::jsonb) $$,
  'check_in_employee OK trên ngày chưa chốt két');

select * from finish();
rollback;
```
*(Lưu ý: `check_in_employee` validate giờ vào ca khớp business_date — payload chỉ `employee_id`+`business_date` → check_in_at default now(); nếu validate đòi giờ khớp ngày, dùng `business_date=current_date` cho test #5 (now() thuộc current_date) và bỏ test #6 hoặc set check_in_at hợp lệ. Implementer điều chỉnh theo hàm thực.)*

- [ ] **Step 2: Chạy → ĐỎ** `node tools/pgtap-local.mjs --reset --all` → 360 FAIL (chưa có rule/guard). Khác xanh.
- [ ] **Step 3: Commit** `test(cash): pgTAP 360 — rule no-open-shift + check-in final-guard (đỏ trước)`

---

## Task 2: `finalize_cash_close_report` — lock + rule (002 + migration)

**Files:** Modify `database/002_functions.sql` (hàm `finalize_cash_close_report`), migration.

- [ ] **Step 1:** Đọc hàm; thêm biến `v_open_shifts int;` (không bắt buộc nếu dùng `exists`). Sau khi load `v_count` + pre-check trùng-final, TRƯỚC tính theory/snapshot, thêm:
```sql
  perform pg_advisory_xact_lock(hashtext('cash_close:' || v_count.business_date::text));
  if exists (select 1 from public.shift_assignments
             where business_date = v_count.business_date and status = 'checked_in') then
    raise exception 'Còn ca chưa ra ca trong ngày % — đóng/ra hết ca trước khi chốt két.', v_count.business_date;
  end if;
```
- [ ] **Step 2:** Dual-write full thân `finalize_cash_close_report` vào migration.
- [ ] **Step 3:** `--reset --all` → 360 #1-3 xanh. Commit `feat(cash): finalize chặn khi còn ca mở + advisory lock per-business_date`

---

## Task 3: `check_in_self` — lock + final-close guard (002 + migration)

- [ ] **Step 1:** Trong `check_in_self`, sau resolve employee + gate 05:30 (đã có), TRƯỚC `insert`, thêm:
```sql
  perform pg_advisory_xact_lock(hashtext('cash_close:' || v_date::text));
  if exists (select 1 from public.cash_close_reports
             where business_date = v_date and report_status = 'final') then
    raise exception 'Ngày % đã chốt két — không thể vào ca. Báo quản lý/chủ quán.', v_date;
  end if;
```
- [ ] **Step 2:** Dual-write full thân `check_in_self` vào migration.
- [ ] **Step 3:** `--reset --all` → 360 #4 xanh. Commit `feat(checkin): check_in_self lock + chặn vào ca ngày đã chốt két`

---

## Task 4: `check_in_employee` — lock + final-close guard (002 + migration)

- [ ] **Step 1:** Trong `check_in_employee`, sau guard owner-only + validate giờ, TRƯỚC `insert`, thêm (dùng `v_date` của hàm):
```sql
  perform pg_advisory_xact_lock(hashtext('cash_close:' || v_date::text));
  if exists (select 1 from public.cash_close_reports
             where business_date = v_date and report_status = 'final') then
    raise exception 'Ngày % đã chốt két — không thể vào ca.', v_date;
  end if;
```
- [ ] **Step 2:** Dual-write full thân `check_in_employee` vào migration.
- [ ] **Step 3:** `--reset --all` → 360 #5-6 xanh. Commit `feat(shifts): check_in_employee lock + chặn vào ca ngày đã chốt két`

---

## Task 5: `edit_shift_payroll_record` — lock (002 + migration)

- [ ] **Step 1:** Trong `edit_shift_payroll_record`, sau `select * into v_record …` (biết `v_record.business_date`), NGAY TRƯỚC final-close guard có sẵn, thêm:
```sql
  perform pg_advisory_xact_lock(hashtext('cash_close:' || v_record.business_date::text));
```
- [ ] **Step 2:** Dual-write full thân `edit_shift_payroll_record` vào migration.
- [ ] **Step 3:** Commit `feat(payroll): edit_shift_payroll_record lock per-business_date (chống race chốt két)`

---

## Task 6: Verify DB + sửa regress

- [ ] **Step 1:** `node tools/pgtap-local.mjs --reset --all`.
- [ ] **Step 2: Sửa regress** (rủi ro chính):
  - **final-guard check-in:** test nào tạo `cash_close_reports` final RỒI gọi `check_in_self`/`check_in_employee` cùng `business_date` → giờ đỏ. Sửa: tách ngày (check-in ngày ≠ ngày final) hoặc bỏ final trước check-in. Rà 310/330/340/350 + bất kỳ test nào INSERT final report.
  - **rule finalize:** test nào có ca `checked_in` trùng `business_date` rồi `finalize_cash_close_report` → đỏ. Sửa: `status='checked_out'` cho ca trong fixture. Rà 040/045/050/060/065/086/250.
  - **lock:** không đổi hành vi đơn-phiên → không gây đỏ.
- [ ] **Step 3:** Lặp tới khi `--reset --all` = `0 failing`; 360 = 6/6. Commit các fixture đã sửa (nếu có) kèm message rõ.

---

## Task 7: UI `cash-view.tsx` — cảnh báo + disable nút Chốt

**Files:** Modify `src/features/cash/cash-view.tsx`

- [ ] **Step 1:** Thêm query (cạnh các query khác ~line 56-59):
```tsx
  const shiftsQuery = useShiftsQuery(supabase, businessDate, true);
```
(import `useShiftsQuery` từ `@/hooks/queries` — kiểm tra export đúng tên.) Và:
```tsx
  const openShifts = (shiftsQuery.data ?? []).filter((s) => s.status === "checked_in");
```
- [ ] **Step 2:** Thêm `AlertBanner` cảnh báo ngay trên cụm nút Chốt (desktop, trước `<div className="flex flex-wrap items-center gap-2">` ~line 350):
```tsx
          {openShifts.length > 0 && (
            <AlertBanner variant="warning">
              Còn {openShifts.length} ca chưa ra ca
              {openShifts.some((s) => s.employee_name)
                ? `: ${openShifts.map((s) => s.employee_name).filter(Boolean).join(", ")}`
                : ""}
              . Đóng/ra hết ca (trang Ca &amp; lương) trước khi chốt két.
            </AlertBanner>
          )}
```
- [ ] **Step 3:** Disable nút "Chốt két" CẢ desktop (line ~365) lẫn mobile (line ~422): thêm `|| openShifts.length > 0` vào `disabled={isBusy || physical === 0 || nextDayExceeds || !step2Opened}` → `disabled={isBusy || physical === 0 || nextDayExceeds || !step2Opened || openShifts.length > 0}`. (spot_audit/Kiểm két KHÔNG đổi.)
- [ ] **Step 4:** `npx tsc --noEmit` → clean. Commit `feat(cash): cảnh báo + chặn nút Chốt khi còn ca chưa ra ca`

---

## Task 8: Verify cuối + PR/CI/merge/tag

- [ ] **Step 1:** `npx tsc --noEmit && npm run test:run` → clean + Vitest pass.
- [ ] **Step 2:** `npm run build` (3009 tắt) → OK.
- [ ] **Step 3:** `node tools/pgtap-local.mjs --reset --all` → 0 failing (360 = 6/6).
- [ ] **Step 4:** Push + PR vào main: title `feat(cash): chống lệch lương khi chốt két — rule + advisory lock`, body tóm tắt (rule + lock 4 hàm + check-in guard + UI; spec link).
- [ ] **Step 5:** `gh pr checks <PR#> --watch` (nếu báo "no checks" → `gh api repos/KaMnh/chill-coffee-erp/actions/runs?head_sha=<sha>`).
- [ ] **Step 6:** (Khuyến nghị) Codex adversarial review impl `--base origin/main`.
- [ ] **Step 7:** Squash merge + tag `v4.13.0`.

---

## Self-Review
**Spec coverage:** §1.1 finalize lock+rule → Task 2. §1.2 check_in_self → Task 3. §1.3 check_in_employee → Task 4. §1.4 edit lock → Task 5. §2 UI → Task 7. §3 test → Task 1 + Task 6 regress. Correctness (3 race) → lock+rule+guard ở Task 2-5. ✓

**Placeholder scan:** Task 1 test có note điều chỉnh `check_in_employee` validate-giờ (không phải placeholder — là cảnh báo tích hợp, implementer xác minh theo hàm thực). Task 2-5 không reproduce full body (chỉ dòng thêm + dual-write full vào migration — chủ ý hàm lớn). Test 360 + UI có full code.

**Type/identifier consistency:** `cash_close:`+business_date key, `v_date`/`v_count.business_date`/`v_record.business_date`, message '%chưa ra ca%' / '%đã chốt két%' khớp giữa test (Task 1) và implementation (Task 2-5). `openShifts` nhất quán Task 7.

**Rủi ro chính:** Task 6 regress (final-rồi-checkin, open-shift-rồi-finalize) — đã ghi rõ phải rà các test đụng các hàm.

---
**Plan complete and saved to `docs/superpowers/plans/2026-06-28-finalize-shift-lock.md`.**
