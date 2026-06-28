# Spec — Quản lý đóng ca hộ (làm tròn phút) + giờ bắt đầu ca (chặn check-in sớm)

> Stack: Next.js 15 App Router · Supabase local (Postgres) · pgTAP · Vitest. Base off `origin/main` (đang ở **v4.11.0**). Quy trình: spec → **Codex adversarial review** → fix findings → TDD implement.
>
> **Self-contained cho reviewer:** mọi tham chiếu hàm kèm đường dẫn + số dòng tại thời điểm viết (v4.11.0). Đối chiếu trực tiếp, không cần ngữ cảnh chat.

## Context (vì sao làm)
Sau Phase 2b, **mọi** thao tác chấm công thủ công bị khóa về owner-only. User cần nới lại có kiểm soát + thêm 1 ràng buộc giờ:
1. **Quản lý đóng ca hộ** nhân viên (owner+manager, **luôn** có — không phụ thuộc `self_checkout_enabled`). Khi quản lý đóng → **làm tròn phút LÊN bội số 15** (15/30/45/60…), tối đa +14′, để lương ra số trọn.
2. **Sửa thời gian ra/vào ca vẫn chỉ owner** (`edit_shift_payroll_record`) — KHÔNG đổi (Phase 2b giữ nguyên). Vì vậy quản lý đóng ca = chốt ở **giờ hiện tại** (không có ô sửa giờ); chỉ owner đặt giờ tùy ý.
3. **Chặn check-in trước giờ bắt đầu ca** (mặc định **05:30**, cấu hình được trong Settings). Áp dụng `check_in_self` (NV tự vào ca). Owner vào ca hộ (`check_in_employee`) **bỏ qua** (override ngoại lệ).

`self_checkout_enabled` (Phase 2a) **độc lập**: chỉ bật/tắt nút "Ra ca" tự phục vụ ở màn Chấm công của NV. Quản lý đóng hộ luôn dùng được.

## Scope
**In:** RPC `check_out_employee_now`; làm tròn phút (chỉ đường quản lý-đóng); guard 05:30 trong `check_in_self`; field `shift_start_time` (config + validate + seed + Settings UI); data/types; UI tách nút Vào/Ra ca + modal xác nhận quản lý-đóng; pgTAP + Vitest.
**Out:** đổi `edit_shift_payroll_record` (giữ owner-only); đổi self-checkout/IP/anchor; làm tròn cho self-checkout hoặc owner full-checkout (giữ phút thực); "ngày làm việc 5:30→5:30" (business_date vẫn ngày dương lịch — xem §7).

## RBAC — bảng chuyển trạng thái
| Hành động | Trước (v4.11.0) | Sau |
|---|---|---|
| Đóng ca giờ-hiện-tại + làm tròn (`check_out_employee_now`, MỚI) | — | **owner + manager** |
| Đóng ca đặt giờ tùy ý (`check_out_employee` full) | owner-only (Phase 2b) | **owner-only** (giữ) |
| Vào ca hộ (`check_in_employee`) | owner-only | **owner-only** (giữ) |
| Sửa lương/giờ (`edit_shift_payroll_record`) | owner-only | **owner-only** (giữ) |
| `check_in_self` (NV tự vào) | mọi lúc | **chặn nếu giờ < `shift_start_time`** |

---

## 1. Database (dual-write `002` + migration `2026-06-28-manager-checkout-shift-start.sql`; seed `004`)

### 1.1 RPC `check_out_employee_now(p_shift_assignment_id uuid)` — owner+manager
Mirror `check_out_self` (002:4654-4720) nhưng: nhận **shift_id** (quản lý chọn NV), guard **owner_manager**, actor = `auth.uid()` (gọi từ session, KHÔNG service-role), **làm tròn phút lên bội số 15**. `security definer`. Authenticated-callable (guard nội bộ tự chặn; KHÔNG cần revoke/grant riêng — blanket grant 003:57 + guard, giống `check_out_employee`).

Logic:
1. `if not public.app_is_owner_manager() then raise exception 'Chỉ chủ quán hoặc quản lý được đóng ca hộ.'; end if;`
2. Lấy ca: `select sa.employee_id, sa.business_date, sa.check_in_at, e.name, e.hourly_rate into v_employee, v_date, v_in, v_name, v_rate from shift_assignments sa join employees e on e.id = sa.employee_id where sa.id = p_shift_assignment_id and sa.status = 'checked_in';` — `if not found then raise exception 'Ca không tồn tại hoặc đã đóng.'; end if;`
3. **Final-close guard** (như check_out_self): `if exists (select 1 from cash_close_reports where business_date = v_date and report_status = 'final') then raise exception 'Ngày % đã chốt két (final) — không thể đóng ca. Hủy báo cáo trước.', v_date; end if;`
4. Tính phút: `v_out := now(); v_raw := greatest(0, round(extract(epoch from (v_out - v_in)) / 60)::integer); v_minutes := ((v_raw + 14) / 15) * 15;` *(integer division → làm tròn LÊN bội số 15; tối đa +14. v_raw=0→0, 1→15, 15→15, 16→30, 65→75, 76→90.)*
5. **Atomic close** (chống đua/double-click): `update shift_assignments set check_out_at = v_out, total_minutes = v_minutes, status = 'checked_out', updated_by = auth.uid() where id = p_shift_assignment_id and status = 'checked_in';` — `if not found / 0 rows then raise exception 'Ca đã được đóng.'; end if;` (dùng `GET DIAGNOSTICS` hoặc `RETURNING ... into` rồi check null).
6. Lương (phụ cấp 0): `v_base := round(((v_minutes::numeric / 60) * coalesce(v_rate,0)) / 1000) * 1000; v_total := v_base;` Upsert `shift_payroll_records` (`on conflict (shift_assignment_id) do update …`, `created_by/edited_by = auth.uid()`, `allowance_amount = 0`, `note = null`) → `v_payroll_id`.
7. `cash_drawer_events`: delete payroll_cash_out cũ của `v_payroll_id`; nếu `v_total > 0` insert (note `'Lương theo lượt (quản lý đóng ca)'`, `created_by = auth.uid()`, `source 'app_action'`).
8. Return `jsonb_build_object('shift_assignment_id', p_shift_assignment_id, 'employee_name', v_name, 'check_out_at', v_out, 'total_minutes', v_minutes, 'total_pay', v_total)`.

> **Làm tròn CHỈ ở đây.** `check_out_self` (NV tự ra) + `check_out_employee` (owner đặt giờ) giữ **phút thực** — không làm tròn.

### 1.1b `check_out_employee` (owner full) — thêm final-close guard (Codex #1)
Hàm owner-full hiện tại (002:557-598) **KHÔNG** có guard final-close → owner đóng ca sau khi chốt két `final` vẫn ghi `shift_payroll_records`/`cash_drawer_events` lệch snapshot báo cáo. Thêm NGAY SAU guard quyền (002:576), TRƯỚC mọi ghi (`v_date` đã có sẵn trong hàm):
```sql
  if exists (select 1 from public.cash_close_reports
             where business_date = v_date and report_status = 'final') then
    raise exception 'Ngày % đã chốt két (final) — không thể đóng ca. Hủy báo cáo trước.', v_date;
  end if;
```
Dual-write 002 + migration (paste full body `check_out_employee` đã sửa). KHÔNG làm tròn phút ở đây (owner giữ phút thực). pgTAP: owner full-checkout sau final close → rejected.

### 1.2 `check_in_self` — chặn trước giờ bắt đầu ca (002:4479-4501)
Khai báo thêm `v_start time;` trong `declare` đầu hàm. Sau khối `if v_employee is null …` (002:4487), TRƯỚC `insert`, thêm:
```sql
  -- Chặn vào ca trước giờ mở ca (mặc định 05:30). Session timezone = Asia/Ho_Chi_Minh
  -- (set toàn cục) → now()::time là giờ địa phương. Owner vào ca hộ (check_in_employee)
  -- KHÔNG qua hàm này nên không bị chặn (override).
  v_start := coalesce(
    (select (value->>'shift_start_time')::time from public.app_settings where key = 'checkin_network'),
    '05:30'::time);
  if now()::time < v_start then
    raise exception 'Chưa tới giờ vào ca (mở lúc %).', to_char(v_start, 'HH24:MI');
  end if;
```

### 1.3 `update_checkin_network_config` — validate + MERGE giữ key cũ (002:4614-4639)
**(a) Validate** — thêm sau khối validate `self_checkout_enabled` (002:4624):
```sql
  if (p_config ? 'shift_start_time') and
     (jsonb_typeof(p_config->'shift_start_time') <> 'string'
      or (p_config->>'shift_start_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
    raise exception 'shift_start_time phải là HH:MM (24 giờ).';
  end if;
```
(Không thêm anchor-IP guard cho field này — không liên quan cổng IP.)

**(b) MERGE giữ key cũ (Codex #3)** — config hiện lưu nguyên `p_config` (`value = excluded.value`, 002:4637) → client/tab cũ (shape v4.11, thiếu `shift_start_time`) lưu sẽ **xoá** giờ đã set, `check_in_self` âm thầm về 05:30. Fix: **shallow-merge** key cũ với key mới (key mới override, key cũ không gửi thì GIỮ). Đổi nhánh upsert:
```sql
  insert into public.app_settings (key, value, is_public, updated_by)
  values ('checkin_network', p_config, false, auth.uid())
  on conflict (key) do update
    set value = public.app_settings.value || excluded.value,  -- existing || new (giữ key cũ bị thiếu)
        is_public = false, updated_by = auth.uid(), updated_at = now();
```
(`||` jsonb = shallow merge; đủ vì config phẳng 1 cấp. Hệ quả chấp nhận: không thể *xoá* key qua RPC — chỉ override; các key này không cần xoá.) pgTAP: lưu config shape cũ (thiếu `shift_start_time`) sau khi đã set '06:00' → giờ vẫn '06:00'.

### 1.4 Seed (`004_seed.sql:116`)
Thêm `"shift_start_time": "05:30"` vào row `checkin_network` seed.

### 1.5 Migration `database/migrations/2026-06-28-manager-checkout-shift-start.sql`
Byte-identical: full `check_out_employee_now`; full `check_in_self` (đã thêm guard); full `update_checkin_network_config` (đã thêm validate). + **data-fix** config cũ:
```sql
update public.app_settings
   set value = value || '{"shift_start_time": "05:30"}'::jsonb
 where key = 'checkin_network' and not (value ? 'shift_start_time');
```

---

## 2. Data layer + types
- `src/lib/types.ts`: `CheckinNetworkConfig` thêm `shift_start_time?: string`. Thêm `ManagerCheckoutResult = { employee_name; check_out_at; total_minutes; total_pay }`.
- `src/lib/data/shifts.ts`: `checkOutEmployeeNow(supabase, shiftId) → supabase.rpc('check_out_employee_now', { p_shift_assignment_id: shiftId })`. (Đường authenticated trực tiếp như `checkOutEmployee` hiện có — KHÔNG qua /api route, KHÔNG IP gate: hành động tin cậy của quản lý từ trang ca.)

## 3. UI
### 3.1 `src/features/shifts/employee-grid.tsx` — tách nút Vào/Ra ca
Hiện tại cả 2 nút trong `{isOwner && (<>…</>)}`. Đổi:
- **"Vào ca"** → chỉ `{isOwner && …}` (quản lý KHÔNG vào ca hộ).
- **"Ra ca"** → `{canManage && …}` (owner+manager). Handler theo role:
  - `isOwner` → `onCheckOut(shift)` (mở `CheckOutModal` đầy đủ — đặt giờ + phụ cấp, như cũ).
  - manager (canManage && !isOwner) → `onManagerCheckout(shift)` (mở modal xác nhận đơn giản).
- Props mới: `onManagerCheckout(shift)`. Giữ `onCheckOut`, `isOwner`, `canManage`.

### 3.2 `src/features/shifts/manager-checkout-modal.tsx` (MỚI) — xác nhận quản lý-đóng
Modal nhỏ: tên NV + dòng "Đóng ca ở **giờ hiện tại**; phút làm tròn lên bội số 15 (tối đa +14′)." Nút **"Đóng ca"** → `checkOutEmployeeNow(shiftId)` → toast kết quả (tên + giờ ra + phút tròn + lương) → invalidate `shifts` + `payroll`. (Mẫu theo các modal hiện có; mutation hook nếu tiện.)

### 3.3 `src/features/shifts/shifts-view.tsx` — wiring
Thêm state `managerCheckoutTarget` + render `<ManagerCheckoutModal>`; truyền `onManagerCheckout={setManagerCheckoutTarget}` cho `EmployeeGrid`. Giữ `CheckOutModal` (owner) như cũ.

### 3.4 `src/features/settings/checkin-config-form.tsx` — ô "Giờ bắt đầu ca"
Thêm input (type time hoặc text HH:MM) bind `shift_start_time`, mặc định `"05:30"`. Vào `DEFAULT_CONFIG`, `configQuery` mapping, state, `useEffect` sync, `dirty`, payload `handleSaveConfig`. Validate client HH:MM (chặn submit nếu sai). Không cần `canEnable` guard (không liên quan anchor IP).

---

## 4. Edge cases
- Manager đóng ca đã đóng / ca không tồn tại → 'Ca không tồn tại hoặc đã đóng.' (400).
- Double-click quản lý-đóng → atomic UPDATE: lần 2 raise 'Ca đã được đóng.' (không nhân đôi payroll/cash).
- staff_operator/anon gọi `check_out_employee_now` → raise quyền.
- Đóng ca ngày đã chốt két final → raise (như self-checkout).
- Làm tròn: v_raw=0→0 (ca 0 phút → lương 0); 14→15; 60→60; 61→75.
- check_in_self trước giờ mở → raise; owner `check_in_employee` lúc 04:00 → vẫn vào được (override).
- Config thiếu `shift_start_time` (DB cũ chưa migrate) → coalesce '05:30'.

## 5. Acceptance criteria + Test plan
**pgTAP** `database/tests/350_manager_checkout.sql` (throwaway `chill_pgtap`; `node tools/pgtap-local.mjs --reset --all`):
- **`check_out_employee_now` (làm tròn + chốt):** fixture ca `check_in_at = now() - 65 phút`, rate 30000. Manager đóng → `status='checked_out'`, **`total_minutes=75`** (65→làm tròn 75), `total_pay = round(75/60×30000/1000)*1000`, có `cash_drawer_events` payroll_cash_out = total_pay. (Thêm 1 case biên: 60→60 không đổi; 61→75.)
- **Quyền:** owner & manager → `lives_ok`; staff_operator → `throws_like '%chủ quán hoặc quản lý%'`; (anon tương tự).
- **Final-close guard:** ca thuộc ngày có `cash_close_reports.report_status='final'` → `throws_like '%chốt két%'`.
- **Đã đóng / double:** gọi lần 2 trên ca vừa đóng → `throws_like '%đã được đóng%'`; payroll vẫn 1 dòng, cash vẫn 1.
- **`check_in_self` gate:** set `shift_start_time='00:00'` → check_in_self `lives_ok` (không chặn). set `shift_start_time='23:59'` → `throws_like '%Chưa tới giờ vào ca%'`. *(Phụ thuộc wall-clock: cửa sổ rủi ro 23:59–00:00 mỗi ngày — chấp nhận; HOẶC tách helper so sánh `(p_now time, p_start time)` để test thuần nếu reviewer yêu cầu.)*
- **`update_checkin_network_config`:** lưu `shift_start_time='06:00'` round-trip OK; giá trị `'25:00'`/`'6:0'`/`'abc'` → `throws_like '%HH:MM%'`. **Merge (Codex #3):** sau khi set '06:00', lưu lại config shape cũ (KHÔNG có `shift_start_time`) → đọc lại vẫn '06:00'.
- **`check_out_employee` (owner full) final-close guard (Codex #1):** ca thuộc ngày đã `final` → owner gọi `check_out_employee` → `throws_like '%chốt két%'`.
- created_at tie-break nếu đụng số dư (xem [[pgtap-created-at-frozen-tiebreak]]).

**Vitest:**
- Làm tròn (nếu tách hàm thuần TS preview) — hoặc bỏ (logic ở DB).
- `checkOutEmployeeNow` data fn gọi đúng RPC (mock supabase).
- UI: `employee-grid` render "Ra ca" cho manager (canManage) và "Vào ca" chỉ owner — nếu có harness render.

**Verify:** `npm run verify:phase` (Vitest + pgTAP) xanh; `tsc` + `npm run build` xanh (KHÔNG build khi `next dev` 3009 chạy). Manual: manager đăng nhập → trang ca thấy "Ra ca" (không thấy "Vào ca") → bấm → modal xác nhận → ca đóng + lương làm tròn; owner → "Ra ca" mở modal đầy đủ; NV tự vào ca trước 05:30 → bị chặn, sau 05:30 → OK.

## 6. Coverage checklist (đối chiếu yêu cầu user)
- [ ] Quản lý (owner+manager) đóng ca hộ, **luôn** có (độc lập self_checkout). 
- [ ] Quản lý đóng → làm tròn phút LÊN bội số 15 (15/30/45/60), tối đa +14′, lương trọn.
- [ ] Sửa giờ ra/vào vẫn **owner only** (không đổi); quản lý đóng = giờ hiện tại, không sửa giờ.
- [ ] Chặn check-in trước giờ bắt đầu ca; giờ **cấu hình được** (mặc định 05:30) ở Settings.
- [ ] Owner vào ca hộ bỏ qua chặn giờ.
- [ ] pgTAP + Vitest theo Test plan; guard quyền + final-close + atomic.

## 7. Risks / notes (cho Codex)
1. **RLS:** `check_out_employee_now` security-definer → bypass RLS (Phase 2b đã bỏ write policy; write chỉ qua RPC). Không cần đổi 003.
2. **Business_date không vắt nửa đêm:** gate giờ + tính ca dùng `current_date`/`now()::time` theo VN. Nếu quán mở xuyên nửa đêm (vd 23:00→06:00) thì ca vắt 2 ngày dương lịch → checkout có thể lệch business_date. Hiện **giả định ca trong ngày** (mở 05:30, đóng trước 24:00). Ngoài scope; flag để user biết.
3. **Làm tròn chỉ đường quản lý:** self-checkout + owner-full giữ phút thực → cùng 1 ca, lương có thể khác tùy ai đóng. Chủ ý (quản lý đóng = ưu ái làm tròn lên).
4. **5:30 gate test phụ thuộc wall-clock** (xem §5) — cân nhắc tách helper thuần nếu cần CI tất định tuyệt đối.
5. **Owner vẫn có 2 đường đóng ca** (`check_out_employee` full + có thể gọi `check_out_employee_now`). UI owner dùng modal đầy đủ; `_now` dành cho manager. Không xung đột.
6. **Codex #2 (race guard final-close ↔ `finalize_cash_close_report`) — HOÃN có chủ ý.** Guard check-rồi-write (§1.1, §1.1b) có thể bị đua: checkout đọc "chưa final" → finalize snapshot → checkout ghi lương sau snapshot → báo cáo final thiếu lượt đó. Quyết định (user, 2026-06-28): **chỉ ship guard**, KHÔNG thêm advisory lock lần này. Lý do: guard đã bịt ca **tuần tự** (đóng ca sau khi đã final → bị chặn — trường hợp thực tế phổ biến); race **đồng thời** rất hiếm ở quán nhỏ (chốt két là thao tác cuối ngày của owner) và **khôi phục được** (void báo cáo → đóng ca → finalize lại). Hardening đầy đủ = `pg_advisory_xact_lock(hashtext('cash_close:'||business_date))` ở mọi đường ghi lương/két (`check_out_employee_now`, `check_out_employee`, `check_out_self`, `edit_shift_payroll_record`) + `finalize_cash_close_report` → **task riêng** sau (đụng code chốt két + retrofit code đã ship; race khó unit-test trong pgTAP một-transaction).

## 8. Files (đại diện)
**DB:** `database/migrations/2026-06-28-manager-checkout-shift-start.sql`, `database/002_functions.sql`, `database/004_seed.sql`, `database/tests/350_manager_checkout.sql`.
**Data/types:** `src/lib/data/shifts.ts`, `src/lib/types.ts`.
**UI:** `src/features/shifts/employee-grid.tsx`, `src/features/shifts/shifts-view.tsx`, `src/features/shifts/manager-checkout-modal.tsx` (mới), `src/features/settings/checkin-config-form.tsx` (+ mutation/query hooks nếu cần).
**Đụng thêm (Codex):** `check_out_employee` (thêm final-close guard, §1.1b); `update_checkin_network_config` (merge config, §1.3b).
**Không đụng:** `check_out_self`, `edit_shift_payroll_record`, `003_rls.sql`, IP/anchor, self_checkout toggle.

## 9. Đánh số bước implement (TDD)
1. (test trước) `350_manager_checkout.sql` — làm tròn, quyền, final-close, double, 5:30 gate, config validate → `--reset --all` **đỏ**.
2. `check_out_employee_now` (002 + migration).
3. `check_in_self` guard 05:30 (002 + migration).
4. `update_checkin_network_config` validate + seed `shift_start_time` (002/004 + migration data-fix).
5. pgTAP → **xanh** (350 + không regress 310/330/340).
6. Types + `checkOutEmployeeNow` + `CheckinNetworkConfig.shift_start_time`.
7. UI: tách nút (employee-grid), `ManagerCheckoutModal`, wiring (shifts-view), ô giờ (checkin-config-form).
8. `tsc` + Vitest + build.
9. Manual verify (owner vs manager vs NV trước/sau 05:30). Commit → PR → CI → Codex adversarial review impl → merge → tag **v4.12.0**.
