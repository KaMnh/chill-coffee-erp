# Chi phí lương real-time (tạm tính) trên Dashboard

**Ngày:** 2026-06-24
**Loại:** Feature (Dashboard KPI + realtime ca/lương)
**Trạng thái:** Spec đã duyệt — chờ chuyển sang chat coding/planning

---

## 1. Mục tiêu

Chủ quán muốn **quan sát chi phí lương nhân viên theo thời gian thật**: một con số "Lương hôm nay (tạm tính)" trên Dashboard, **tự tăng theo thời gian** khi còn người đang trong ca, gồm phần **đã chốt** (người đã ra ca) + phần **đang phát sinh** (người đang trong ca, tính tới thời điểm hiện tại).

Phạm vi đã chốt với chủ quán:
- **Một con số tổng** (không làm danh sách per-employee).
- **Thay thế** thẻ KPI "Lương đã phát" hiện có bằng con số tạm tính real-time.
- Tính **mọi hình thức trả** (cả tiền mặt lẫn chuyển khoản), không chỉ tiền mặt.

## 2. Hiện trạng (đã khảo sát)

- **Ca làm** `shift_assignments` (`database/001_schema.sql`): `status ∈ {checked_in, checked_out, cancelled}`, `check_in_at`, `check_out_at` (nullable). **Ca đang mở** = `status='checked_in'` và `check_out_at IS NULL`.
- **Lương** chốt lúc ra ca vào `shift_payroll_records` (`total_pay`, `base_pay`, `allowance_amount`, `hourly_rate`, `payment_method`, `business_date`). Người **đang trong ca chưa có** bản ghi lương.
- **Công thức** (RPC `check_out_employee`, `database/002_functions.sql`):
  `minutes = greatest(0, round((check_out − check_in) giây /60))`;
  `base = round(((minutes/60) × hourly_rate)/1000)×1000`; `total = base + allowance_amount`.
- **Phụ cấp tự động**: nếu thời lượng ca ≥ `shift_bonus_config.threshold_hours` thì allowance = `shift_bonus_config.bonus_amount`. Config ở `app_settings.shift_bonus_config` (mặc định `{threshold_hours:7, bonus_amount:10000}`), check-out modal đang dùng.
- **Rate**: `employees.hourly_rate` (numeric, ≥ 0).
- **Realtime đã có**: `src/hooks/use-realtime-invalidate.ts` subscribe `postgres_changes` cho `cash_close_reports`, `expenses`, `safe_transactions` → invalidate query tương ứng. **Chưa** subscribe `shift_assignments`/`shift_payroll_records` (khoảng trống cần lấp).
- **Dashboard**: `src/features/dashboard/dashboard-view.tsx` + `kpi-bar.tsx`. Thẻ **"Lương đã phát"** dùng `data.payroll_paid` (= `payroll_cash_total`, **chỉ tiền mặt**, đã chốt); thẻ **"Đang trong ca"** đếm `data.active_staff`. Dashboard query staleTime 60s, không realtime cho ca/lương.

## 3. Thiết kế

### 3.1. Tính toán (hàm thuần, test được — đặt `src/lib/`)
`computeLiveLaborCost({ finalizedTotal, activeShifts, now, bonusConfig }) → number` với:
- `finalizedTotal`: Σ `total_pay` của các ca **đã chốt** hôm nay (mọi `payment_method`).
- `activeShifts`: danh sách ca đang mở của hôm nay, mỗi phần tử `{ check_in_at, hourly_rate }`.
- Với mỗi ca đang mở:
  - `minutes = max(0, floor((now − check_in_at) / 60s))` (clamp ≥ 0 phòng check-in tương lai).
  - `base = round(((minutes/60) × hourly_rate) / 1000) × 1000` (làm tròn 1.000đ, khớp công thức ra ca).
  - `allowance = (minutes/60 ≥ bonusConfig.threshold_hours) ? bonusConfig.bonus_amount : 0`.
  - `accrual = base + allowance`.
- Kết quả = `finalizedTotal + Σ accrual`.
- **Không** ghi DB; đây là số hiển thị tạm tính thuần client.

### 3.2. Dữ liệu cần cho Dashboard
> "Hôm nay" trong toàn bộ mục này = **`businessDate` của dashboard** (ngày làm việc hiện tại đã có sẵn ở `dashboard-view`), không phải `current_date` thô — để khớp ranh giới ngày làm việc với các KPI khác.

- (1) **Tổng lương đã chốt hôm nay (mọi hình thức)** = `Σ total_pay` từ `shift_payroll_records` của `business_date = hôm nay`.
  - Lưu ý: KHÁC `payroll_cash_total` (cash-only) đang dùng. Triển khai: thêm trường mới vào payload dashboard (vd `payroll_total_all` / `labor_cost_finalized`) hoặc một query nhẹ riêng. Quyết định cuối để chat code chọn, nhưng phải là **tổng mọi method**.
- (2) **Danh sách ca đang mở** (hôm nay) kèm `check_in_at` + `hourly_rate` (join `employees`).
  - Có thể tái dùng `loadShiftAssignments` (lọc `status='checked_in'`, `check_out_at null`) + join rate từ `useEmployeesQuery`, hoặc query gọn riêng. Cần đảm bảo có `hourly_rate` cho client tính.
- (3) `shift_bonus_config` từ `app_settings` (đã có nơi đọc — tái dùng).

### 3.3. Hook + tick real-time
- `useLiveLaborCost(...)`: gom (1)(2)(3), chạy **timer mỗi 60 giây** cập nhật `now` → gọi `computeLiveLaborCost` → trả số hiện tại. Dọn timer khi unmount.
- `KpiBar` chỉ hiển thị (label "Lương hôm nay (tạm tính)" + nhãn nhỏ "tạm tính"); logic nằm ở hook.
- Cadence 60s là đủ (mỗi phút thêm `rate/60`); không cần tick từng giây.

### 3.4. Realtime cập nhật tập ca/lương
- Trong `use-realtime-invalidate.ts`, thêm subscribe `postgres_changes` cho `shift_assignments` (insert/update) và `shift_payroll_records` (insert/update) → invalidate các query liên quan (dashboard + shift + payroll của `businessDate`).
- Kết quả: vào ca → số bắt đầu tăng; ra ca → phần đó chuyển từ "đang phát sinh" sang "đã chốt"; sửa lương → cập nhật ngay; mở 2 thiết bị thấy đồng bộ.

## 4. Kiểm thử
- **Vitest** cho `computeLiveLaborCost`:
  - Không ca đang mở → = finalizedTotal.
  - 1 ca đang mở: base đúng (làm tròn 1.000đ), cộng finalized.
  - clamp ≥ 0 khi `check_in_at` ở tương lai.
  - Ngưỡng phụ cấp: dưới ngưỡng không cộng, đạt ngưỡng cộng `bonus_amount`.
  - Nhiều ca đang mở: cộng dồn.
- **Thủ công**: check-in → số tăng dần theo phút; check-out → vào phần đã chốt; realtime giữa 2 phiên.

## 5. Ngoài phạm vi (YAGNI)
- Bản mobile prototype `src/app/(preview)/mobile/...` (mock).
- **Không** danh sách chi phí per-employee (chủ quán chọn 1 con số tổng).
- **Không** đổi công thức/cách ghi lương lúc ra ca (chỉ đọc + tạm tính hiển thị).
- Không lưu lịch sử con số tạm tính; không cảnh báo ngưỡng.

## 6. Tiêu chí hoàn thành
- [ ] Thẻ "Lương đã phát" được thay bằng **"Lương hôm nay (tạm tính)"** = đã chốt (mọi method) + đang phát sinh.
- [ ] Con số tự tăng theo phút khi có người đang trong ca (client tick), không cần tải lại.
- [ ] Vào/ra ca/sửa lương phản ánh ngay nhờ subscribe realtime `shift_assignments` + `shift_payroll_records`.
- [ ] `computeLiveLaborCost` có Vitest xanh (rounding, clamp, ngưỡng phụ cấp, nhiều ca).
- [ ] Không vỡ KPI khác trên dashboard.
