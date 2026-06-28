# Spec — Chống lệch lương khi chốt két: rule "ra ca hết" + advisory lock per-business_date

> Stack: Next.js 15 · Supabase local (Postgres) · pgTAP · Vitest. Base off `origin/main` (**v4.12.0**). Quy trình: spec → **Codex adversarial review** → fix → TDD implement.
>
> **Bản v2** — sau Codex review v1: rule-đếm ĐƠN ĐỘC không đủ (count không phải serialization boundary). Bổ sung **advisory lock per-business_date** (đúng idiom `safe_fund:*` đã có) + **final-close guard cho check-in**. Rule giữ lại cho UX + đóng race close↔finalize.

## Context
v4.12.0 cho manager đóng ca hộ → lo lệch lương khi đóng ca/sửa lương **đồng thời** với chốt két. Codex (v1) chỉ ra 2 race **count rule không bịt**:
- **Check-in ↔ finalize:** check-in tạo ca `checked_in` sau lúc finalize đếm (0 ca) nhưng trước khi commit → ca kẹt trên ngày đã final (checkout bị final-guard chặn).
- **Edit ↔ finalize (2 role khác nhau):** `finalize` là `app_is_staff_or_above` (manager/operator) còn `edit_shift_payroll_record` là owner → manager chốt trong khi owner sửa lương → báo cáo final lệch ledger.

Giải pháp: **serialize per-business_date bằng advisory lock** (cơ chế đã dùng cho sổ quỹ: `pg_advisory_xact_lock(hashtext('safe_fund:cash'))`, `hashtext('period_close')`). Thêm rule "ra ca hết mới chốt" cho UX + đóng race close↔finalize mà không cần lock checkout.

## Scope
**In:** advisory lock `cash_close:<business_date>` trên `finalize_cash_close_report` + `check_in_self` + `check_in_employee` + `edit_shift_payroll_record`; rule no-open-shift trong finalize; final-close guard cho check-in; UI cash-view (cảnh báo + disable Chốt); pgTAP; migration.
**Out:** lock trên `check_out_*` (KHÔNG cần — rule + atomicity của close đã đủ, xem §"Correctness"); ca vắt nửa đêm (giả định không).
**Supersede:** task advisory-lock #2 (`task_61385a67`) — spec này gồm cả nó. **Dừng session #2 song song** để khỏi sửa `finalize_cash_close_report` hai nơi.

## Correctness (per race) — vì sao bộ này đủ
Khóa dùng chung: `perform pg_advisory_xact_lock(hashtext('cash_close:' || <business_date>::text));` đặt SỚM trong mỗi hàm (sau khi biết business_date, trước read/write). Transaction-scoped → tự nhả khi commit/rollback. Cùng key ⟹ các hàm cùng `business_date` chạy **tuần tự**.

1. **close ↔ finalize — KHÔNG cần lock checkout.** Một ca chỉ `checked_out` cùng transaction với việc ghi payroll. finalize đếm `checked_in` rồi mới snapshot. READ COMMITTED:
   - checkout commit *trước* lúc finalize đếm → đếm thấy 0 (ca đã đóng) → snapshot thấy payroll (cùng commit). ✓
   - checkout chưa commit lúc đếm → đếm thấy `checked_in` > 0 → finalize **RAISE** (rule). Không snapshot dở. ✓
   Mọi trường hợp: finalize hoặc gồm đủ payroll, hoặc từ chối. Không lệch.
2. **check-in ↔ finalize — cần lock + final-guard.** Lock: check-in và finalize không chen nhau.
   - finalize giữ lock → check-in chờ → finalize commit final → check-in chạy, thấy ngày đã final → **final-guard raise** ("ngày đã chốt két, không vào ca"). Không tạo ca kẹt. ✓
   - check-in giữ lock → finalize chờ → check-in commit (ca `checked_in`, chưa lương) → finalize đếm thấy ca mở → **RAISE** (rule). Manager đóng ca mới rồi chốt lại. ✓
3. **edit ↔ finalize — cần lock.** Lock: edit và finalize tuần tự.
   - finalize trước → edit thấy final → `edit`'s final-close guard có sẵn raise. ✓
   - edit trước → finalize snapshot lương MỚI (edit đã commit). ✓

---

## 1. Database (dual-write `002` + migration `2026-06-28-finalize-shift-lock.sql`)

> Lock idiom: dòng `perform pg_advisory_xact_lock(hashtext('cash_close:' || <date_var>::text));`. Đặt ngay sau guard quyền + sau khi biết business_date, TRƯỚC mọi read-rồi-write. (Số dòng dưới ~v4.12.0; implementer đọc file để định vị chính xác.)

### 1.1 `finalize_cash_close_report` — lock + rule no-open-shift
Sau khi load `v_count` (biết `v_count.business_date`) + pre-check trùng-final, thêm:
```sql
  perform pg_advisory_xact_lock(hashtext('cash_close:' || v_count.business_date::text));
  -- rule: phải ra ca hết trước khi chốt (UX + đóng race close↔finalize)
  if exists (select 1 from public.shift_assignments
             where business_date = v_count.business_date and status = 'checked_in') then
    raise exception 'Còn ca chưa ra ca trong ngày % — đóng/ra hết ca trước khi chốt két.', v_count.business_date;
  end if;
```
(Đặt lock TRƯỚC rule-check để serialize. Chỉ chặn ca cùng `business_date`.)

### 1.2 `check_in_self` — lock + final-close guard
Sau khi resolve `v_employee` + (gate 05:30 đã có), TRƯỚC `insert`:
```sql
  perform pg_advisory_xact_lock(hashtext('cash_close:' || v_date::text));
  if exists (select 1 from public.cash_close_reports
             where business_date = v_date and report_status = 'final') then
    raise exception 'Ngày % đã chốt két — không thể vào ca. Báo quản lý/chủ quán.', v_date;
  end if;
```
(`v_date := current_date` đã có trong hàm.)

### 1.3 `check_in_employee` — lock + final-close guard
Tương tự 1.2, sau guard quyền (owner-only) + validate giờ, TRƯỚC `insert`. Dùng `v_date` của hàm:
```sql
  perform pg_advisory_xact_lock(hashtext('cash_close:' || v_date::text));
  if exists (select 1 from public.cash_close_reports
             where business_date = v_date and report_status = 'final') then
    raise exception 'Ngày % đã chốt két — không thể vào ca.', v_date;
  end if;
```

### 1.4 `edit_shift_payroll_record` — lock
Hàm đã có final-close guard (raise nếu ngày đã final). Thêm lock NGAY TRƯỚC guard đó, dùng `v_record.business_date` (đã select vào `v_record`):
```sql
  perform pg_advisory_xact_lock(hashtext('cash_close:' || v_record.business_date::text));
```
(Lock + guard có sẵn ⟹ edit↔finalize tuần tự + edit từ chối ngày final.)

### 1.5 Migration
Dual-write: paste **full thân** 4 hàm đã sửa (`finalize_cash_close_report`, `check_in_self`, `check_in_employee`, `edit_shift_payroll_record`) vào `database/migrations/2026-06-28-finalize-shift-lock.sql`, byte-identical. Không data-fix.

---

## 2. UI — `src/features/cash/cash-view.tsx`
- `const shiftsQuery = useShiftsQuery(supabase, businessDate, true);` → `const openShifts = (shiftsQuery.data ?? []).filter((s) => s.status === "checked_in");`
- `openShifts.length > 0` → `AlertBanner variant="warning"`: *"Còn N ca chưa ra ca: {tên…}. Đóng/ra hết ca (trang Ca & lương) trước khi chốt két."* phía trên cụm nút Chốt.
- **Disable nút "Chốt két & tạo báo cáo"** (desktop + mobile): thêm `|| openShifts.length > 0` vào `disabled`. spot_audit KHÔNG bị chặn.
- (RPC vẫn enforce — UI chỉ chặn sớm.)

---

## 3. Acceptance criteria + Test plan
**pgTAP** `database/tests/360_finalize_shift_lock.sql` (+ rà regress):
- Rule: ca `checked_in` cùng `business_date` với cash_count → `finalize_cash_close_report` → `throws_like '%chưa ra ca%'`. Đóng ca → finalize `lives`/`status='final'`. Ca `checked_in` ngày KHÁC → finalize ngày gốc `lives`.
- check-in final-guard: tạo `cash_close_reports` final cho ngày D → `check_in_self`/`check_in_employee` vào ngày D → `throws_like '%đã chốt két%'`. Ngày chưa final → `lives`.
- Lock: KHÔNG test được contention trong pgTAP (1 transaction). Assert tối thiểu các hàm vẫn chạy đúng sau khi thêm lock (đã có ở các test 040/310/350…). Ghi rõ giới hạn: race thật cần 2 phiên psql (ngoài scope pgTAP) — lock dựa theo idiom `safe_fund` đã chứng minh.
- **Regress (BẮT BUỘC):** `--reset --all`. Hàm đụng: `check_in_self` (310/330/340/350), `check_in_employee` (340…), `edit_shift_payroll_record` (250…), `finalize_cash_close_report` (040/045/050/060/065/086/250). (a) **final-guard check-in**: test nào tạo `cash_close_reports` final RỒI gọi check-in cùng ngày sẽ đỏ → tách ngày hoặc bỏ final. (b) **rule finalize**: test nào có ca `checked_in` trùng `business_date` rồi finalize sẽ đỏ → đóng ca trong fixture. (c) lock không đổi hành vi đơn-phiên. Rà + sửa fixture.

**Vitest:** optional (UI disable nút khi có ca mở) nếu có harness; logic mỏng → có thể bỏ, ghi rõ.

**Verify:** `npm run verify:phase` xanh; `tsc` + `build` xanh. Manual: còn ca mở → cảnh báo + nút Chốt mờ; vào ca sau khi đã chốt két → bị chặn.

## 4. Coverage checklist (đối chiếu yêu cầu user)
- [ ] "Ra ca hết mới chốt": rule trong finalize + UI cảnh báo/disable.
- [ ] Chống lệch tiền THẬT: advisory lock per-business_date trên finalize + check_in_self + check_in_employee + edit_shift_payroll_record (đóng race Codex #1+#2).
- [ ] check-in bị chặn trên ngày đã chốt két (chống ca kẹt).
- [ ] checkout KHÔNG cần lock (rule + atomicity đủ) — đỡ scope.
- [ ] pgTAP rule + final-guard + regress; dual-write + migration.

## 5. Risks / notes (cho Codex)
1. **Lock idiom đã có** (`safe_fund:*`, `period_close` — 002:971…4137) → thêm `cash_close:<date>` nhất quán, không trùng namespace.
2. **Lock không unit-test được race** trong pgTAP (1 transaction). Test phần guard/rule deterministic; tin vào idiom đã chứng minh + (tùy chọn) script 2-phiên psql.
3. **Regress là rủi ro chính** (§3) — final-guard + rule có thể làm đỏ fixture cũ tạo final-rồi-checkin hoặc open-shift-rồi-finalize. Phải rà.
4. **check-in trễ trên ngày đã final** giờ bị chặn cứng — nếu owner cần vẫn cho vào ca sau chốt (hiếm), phải void báo cáo trước. Chấp nhận (đúng nghiệp vụ: đã chốt thì không phát sinh thêm).
5. **Lock granularity**: per-business_date → check-in/edit/finalize CÙNG ngày tuần tự; ngày khác song song. Tần suất thấp (vài check-in + 1 finalize/ngày) → contention không đáng kể, như `safe_fund`.

## 6. Files
**DB:** `database/migrations/2026-06-28-finalize-shift-lock.sql`, `database/002_functions.sql`, `database/tests/360_finalize_shift_lock.sql` (+ sửa fixture regress).
**UI:** `src/features/cash/cash-view.tsx`.
**Không đụng:** `check_out_*` (không lock), RLS, IP/anchor.

## 7. Bước implement (TDD)
1. (test) `360_finalize_shift_lock.sql` — rule finalize + final-guard check-in → đỏ.
2. Lock + rule `finalize_cash_close_report` (002 + migration).
3. Lock + final-guard `check_in_self` + `check_in_employee` (002 + migration).
4. Lock `edit_shift_payroll_record` (002 + migration).
5. `--reset --all` → xanh; **rà + sửa fixture regress** (final-rồi-checkin, open-shift-rồi-finalize).
6. UI cash-view (useShiftsQuery + AlertBanner + disable nút desktop+mobile).
7. tsc + Vitest + build.
8. Commit → PR → CI → Codex adversarial review impl → merge → tag **v4.13.0**.
