# Spec — Bắt buộc ra ca hết trước khi chốt két (chống lệch tiền lương)

> Stack: Next.js 15 · Supabase local (Postgres) · pgTAP · Vitest. Base off `origin/main` (đang ở **v4.12.0**). Quy trình: spec → **Codex adversarial review** → fix → TDD implement.
>
> **Self-contained cho reviewer:** mọi tham chiếu hàm kèm đường dẫn + số dòng (v4.12.0).

## Context (vì sao làm)
v4.12.0 cho **manager đóng ca hộ** (`check_out_employee_now`). Codex finding #2 (đã hoãn): guard final-close là check-rồi-write → **race** với `finalize_cash_close_report` (đóng ca lúc đang chốt két → báo cáo final thiếu lương). User chọn giải pháp **đơn giản hơn advisory lock**: một **quy tắc nghiệp vụ** — `finalize_cash_close_report` **TỪ CHỐI** chốt khi còn ca `checked_in` cho ngày đó → buộc đóng/ra hết ca trước → snapshot lương đầy đủ. (Thay thế task advisory-lock #2.)

## Vì sao đúng (correctness)
Một ca chỉ chuyển `checked_in → checked_out` **cùng transaction** với việc ghi `shift_payroll_records` + `cash_drawer_events` (xem `check_out_employee_now`/`check_out_self`/`check_out_employee` — UPDATE status + insert payroll + cash là một RPC, commit chung). Do đó nếu `finalize` thấy **0 ca `checked_in`** cho ngày D ⟹ mọi payroll của D đã commit ⟹ snapshot lương đầy đủ.
- **MVCC (READ COMMITTED, default):** nếu statement "đếm ca mở" của finalize thấy 0 (close đã commit) thì statement snapshot-lương (chạy sau) cũng thấy payroll đó → không lệch.
- Nếu close **chưa** commit lúc finalize đếm → finalize thấy ca `checked_in` → **raise/từ chối** (không snapshot dở). Manager đóng nốt rồi chốt lại. Không mất tiền.

## Scope
**In:** guard "no open shift" trong `finalize_cash_close_report`; pgTAP; UI `cash-view` pre-check (cảnh báo + disable nút "Chốt két" khi còn ca mở).
**Out:** advisory lock (thay bằng rule này); race `edit_shift_payroll_record` ↔ finalize (owner-only, một người, tuần tự → ~0; đã có final-close guard riêng — xem §6); ca vắt nửa đêm (giả định không, business_date dương lịch).

## RBAC
Không đổi. `finalize_cash_close_report` vẫn `app_is_staff_or_above()` (owner/manager/operator). Guard mới áp cho **mọi** caller.

---

## 1. Database (dual-write `002` + migration `2026-06-28-finalize-requires-closed-shifts.sql`)

### 1.1 `finalize_cash_close_report` — guard "không còn ca mở" (002:2797-…)
`v_count` (chứa `business_date`) đã load tại 002:2827. Thêm biến `v_open_shifts int;` vào `declare`. Đặt guard **SAU** pre-check trùng-final (002:2835-2842), **TRƯỚC** mọi tính toán/snapshot lương:
```sql
  -- Chống lệch lương: phải ra ca hết trước khi chốt. Ca chỉ thành 'checked_out'
  -- cùng transaction với việc ghi payroll → finalize thấy 0 ca mở ⟹ snapshot lương
  -- đầy đủ (thay advisory lock; xem spec).
  select count(*) into v_open_shifts
    from public.shift_assignments
   where business_date = v_count.business_date and status = 'checked_in';
  if v_open_shifts > 0 then
    raise exception 'Còn % ca chưa ra ca trong ngày % — đóng/ra hết ca trước khi chốt két.',
      v_open_shifts, v_count.business_date;
  end if;
```
Dual-write: paste **full thân** `finalize_cash_close_report` (đã thêm guard) vào migration, byte-identical.

> **Chỉ chặn ca cùng `business_date` với báo cáo.** Ca mở ngày khác (vd NV quên ra ca hôm trước) KHÔNG chặn chốt hôm nay (không ảnh hưởng lương ngày nay). Đúng — cash close theo từng `business_date`.

---

## 2. UI — `src/features/cash/cash-view.tsx`
- Thêm `const shiftsQuery = useShiftsQuery(supabase, businessDate, true);` (đã dùng ở trang ca; trả `ShiftAssignment[]` có `employee_name` + `status`). `const openShifts = (shiftsQuery.data ?? []).filter((s) => s.status === "checked_in");`
- Khi `openShifts.length > 0`: hiện `AlertBanner variant="warning"` phía trên cụm nút Chốt: *"Còn N ca chưa ra ca: {tên, tên…}. Đóng/ra hết ca (trang Ca & lương) trước khi chốt két."*
- **Disable nút "Chốt két"** (CẢ desktop 002:363-367 lẫn mobile 002:420-425): thêm `|| openShifts.length > 0` vào điều kiện `disabled`.
- Nút spot_audit (kiểm két không chốt) **KHÔNG** bị chặn (chỉ `shift_close`/finalize bị).
- (RPC vẫn enforce — defense-in-depth; UI chỉ chặn sớm cho UX.)

---

## 3. Edge cases
- Còn ca mở cùng ngày → bấm Chốt: nút disabled (UI) + nếu lách → RPC raise '%chưa ra ca%'.
- Ca mở ngày KHÁC → không chặn chốt ngày nay.
- Mọi ca đã ra → chốt bình thường.
- spot_audit (kiểm két) → không bị chặn.
- Void báo cáo rồi chốt lại: guard re-check lúc finalize lại (nếu lúc đó còn ca mở → chặn).

## 4. Acceptance criteria + Test plan
**pgTAP** — thêm vào `database/tests/040_finalize_cash_close_report.sql` (đã có fixture cash_count + finalize) HOẶC file mới `041_finalize_requires_closed_shifts.sql`:
- Tạo `shift_assignments` `status='checked_in'` cùng `business_date` với cash_count → `finalize_cash_close_report` → `throws_like '%chưa ra ca%'`.
- Đóng ca đó (`status='checked_out'`) → `finalize` → `lives_ok` / trả `status='final'`.
- Ca `checked_in` ở `business_date` KHÁC → `finalize` ngày gốc → vẫn `lives_ok` (không chặn).
- **Regress (BẮT BUỘC):** chạy `node tools/pgtap-local.mjs --reset --all`; rà các test đụng `finalize_cash_close_report` (040, 045, 050, 060, 065, 086, 250) — nếu test nào tạo ca `checked_in` trùng `business_date` rồi finalize, guard mới sẽ làm đỏ → đóng ca trong fixture đó (`status='checked_out'`) hoặc đảm bảo không có ca mở. (Phần lớn test cash-close không tạo shift → không ảnh hưởng; phải verify.)

**Vitest:** optional (UI). Nếu có harness render `cash-view`, assert nút Chốt disabled khi có ca checked_in. Logic mỏng → có thể bỏ, ghi rõ.

**Verify:** `npm run verify:phase` xanh; `tsc` + `npm run build` xanh (3009 tắt). Manual: còn ca mở → trang chốt két cảnh báo + nút Chốt mờ; đóng hết ca → chốt được.

## 5. Coverage checklist (đối chiếu yêu cầu user)
- [ ] `finalize_cash_close_report` từ chối khi còn ca `checked_in` cùng ngày → "ra ca hết mới chốt".
- [ ] UI: cảnh báo "Còn N ca chưa ra ca: [tên]" + disable nút Chốt (desktop + mobile).
- [ ] Chỉ chặn ca cùng business_date; spot_audit không bị chặn.
- [ ] pgTAP guard + regress các test finalize; dual-write 002 + migration.

## 6. Risks / notes (cho Codex)
1. **Thay advisory lock #2:** rule này đóng race **close ↔ finalize** (mối lo chính của manager-checkout: manager đóng ca trong khi owner/manager chốt — hai người khác nhau). Đúng nhờ atomicity của close (status+payroll cùng transaction) + MVCC.
2. **Race còn lại — edit ↔ finalize:** owner sửa lương một ca ĐÃ đóng (`edit_shift_payroll_record`) đồng thời với finalize. Rule này KHÔNG đóng (ca đã `checked_out`). Nhưng: edit là **owner-only**, cùng một người thao tác tuần tự → xác suất ~0; `edit_shift_payroll_record` đã có final-close guard. Chấp nhận (không thêm lock).
3. **Regress finalize tests:** guard có thể làm đỏ test nào tạo ca mở + finalize cùng ngày — §4 yêu cầu rà + sửa fixture. Đây là rủi ro triển khai chính.
4. **task advisory-lock (chip) đã được user mở ở session khác:** rule này supersede; nên dừng/chuyển hướng session đó để khỏi đụng `finalize_cash_close_report` hai nơi.

## 7. Files
**DB:** `database/migrations/2026-06-28-finalize-requires-closed-shifts.sql`, `database/002_functions.sql`, `database/tests/040_finalize_cash_close_report.sql` (hoặc `041_*` mới).
**UI:** `src/features/cash/cash-view.tsx`.
**Không đụng:** RPC chấm công, RLS, advisory lock.

## 8. Bước implement (TDD)
1. (test) pgTAP guard (còn ca mở → raise; đóng hết → lives; ngày khác → lives) → đỏ.
2. Guard trong `finalize_cash_close_report` (002 + migration full body).
3. `--reset --all` → xanh; sửa fixture các finalize test nếu regress.
4. UI cash-view: useShiftsQuery + AlertBanner + disable nút (desktop + mobile).
5. tsc + Vitest + build.
6. Commit → PR → CI → Codex adversarial review impl → merge → tag **v4.12.1** (patch — hardening).
