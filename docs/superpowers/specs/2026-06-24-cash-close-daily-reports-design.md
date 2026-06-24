# Báo cáo chốt két "theo ngày" đa ngày + nạp két mỗi ngày

**Ngày:** 2026-06-24
**Loại:** Feature (mở rộng màn Báo cáo → tab Chốt két)
**Trạng thái:** Spec đã duyệt — chờ chuyển sang chat coding/planning

---

## 1. Mục tiêu

Trong **Báo cáo → tab "Chốt két"**, mục **"Báo cáo theo ngày"** hiện chỉ liệt kê báo cáo của **1 ngày**. Chủ quán muốn:

1. Xem **báo cáo của các ngày trước** — mặc định **7 ngày gần nhất**, **mới nhất trên đầu**, và **chọn được khoảng ngày khác**.
2. Mỗi ngày hiển thị **tóm tắt "nạp két" của riêng ngày đó** (không phải tổng gộp toàn bộ), dạng gọn: `Tiền mặt: X đ · Chuyển khoản: Y đ`.

## 2. Hiện trạng (đã khảo sát)

- Màn Báo cáo: `src/features/reports/reports-view.tsx` — `Tabs` gồm: **Chốt két**, Tồn kho, Doanh số, Chi phí + lương, Theo giờ.
- Tab "Chốt két" (`CashCloseTab` trong cùng file) bố cục 2 cột: trái `ReportList`, phải `PrintableReport` + nút In/Tải ảnh.
- `ReportList` (`src/features/reports/report-list.tsx`) đã có tiêu đề **"Báo cáo theo ngày"**. Mỗi dòng hiện: `formatDateTime(closed_at)` + chênh lệch + badge trạng thái. Sắp theo thứ tự RPC trả về.
- Dữ liệu: `useReportsQuery(supabase, businessDate)` (`src/hooks/queries/use-cash-queries.ts`) → `loadCashCloseReportsByDate` → RPC `get_cash_close_reports_by_date(p_business_date)` — **chỉ 1 ngày**.
- Chi tiết phiếu: chọn dòng → `loadCashCloseReport(id)` → render `PrintableReport`. Auto-chọn `reportsQuery.data?.[0]`.
- **Dữ liệu nạp két đã có sẵn** trong mỗi báo cáo (`CashCloseReport`, `src/lib/types.ts`):
  - `safe_deposit_amount` = tiền mặt nạp vào quỹ khi chốt (`= physical_cash − leave_for_next_day`).
  - `bank_transfer_confirmed` = chuyển khoản nạp vào quỹ khi chốt.
  - Khi finalize, server tạo 2 giao dịch `deposit_close` (quỹ `cash` + quỹ `transfer`) — xem `database/migrations/2026-06-10-safe-two-funds-inflow.sql` (`finalize_cash_close_report`). ⇒ **không cần tính toán mới ở backend**, chỉ đọc 2 cột này.
- Ràng buộc dữ liệu: **tối đa 1 báo cáo `final` / business_date** (enforce trong `finalize_cash_close_report`); 1 ngày có thể có thêm báo cáo `voided`.

## 3. Phạm vi thay đổi

### 3.1. Backend — RPC mới theo khoảng ngày
- Thêm RPC `get_cash_close_reports_by_period(p_from date, p_to date)`:
  - Trả các báo cáo có `business_date` trong `[p_from, p_to]`, gồm cả `final` lẫn `voided`.
  - Sắp xếp **`business_date` DESC**, cùng ngày thì **`closed_at` DESC** (ổn định, tránh tráo final/voided ngẫu nhiên).
  - Cùng họ/độ "shape" trả về như `get_cash_close_reports_by_date` để `ReportList` tái dùng (mỗi phần tử là `CashCloseReport` đủ field cho danh sách, gồm `business_date`, `safe_deposit_amount`, `bank_transfer_confirmed`, `difference`, `report_status`, `closed_at`).
  - Quyền: theo đúng RPC hiện có (staff trở lên xem báo cáo — bám theo `get_cash_close_reports_by_date`).
  - **Quy ước dual-write của dự án:** thân hàm RPC phải được ghi **đồng nhất** vào cả file migration mới (`database/migrations/YYYY-MM-DD-*.sql`) **và** file canonical `database/002_functions.sql` (byte-identical), kèm `grant execute ... to authenticated`. Kiểm tra lại đúng pattern các RPC `get_cash_close_report*` hiện có.
- Thêm `loadCashCloseReportsByPeriod(supabase, from, to)` trong `src/lib/data/reports.ts` (giống `loadCashCloseReportsByDate`).

### 3.2. Hook & query key
- Thêm `useReportsByPeriodQuery(supabase, from, to, enabled)` trong `src/hooks/queries/use-cash-queries.ts`, query key kiểu `["cash-close-reports", "period", from, to]`.
- Giữ `useReportsQuery` (1 ngày) nếu nơi khác còn dùng; tab Chốt két chuyển sang dùng query theo khoảng.
- Lưu ý invalidation: mutation chốt/sửa/hủy đang invalidate theo prefix `cash-close-reports` (xem `use-cash-mutations.ts`) — đảm bảo key mới cũng khớp prefix để tự refresh.

### 3.3. UI — bộ chọn khoảng ngày (state khoảng)
- Trong `CashCloseTab`: thêm state `{ from, to }`, **mặc định = 7 ngày gần nhất** (`to = businessDate`/hôm nay, `from = to − 6 ngày`).
- Thêm **bộ lọc khoảng ngày (từ → đến)** phía trên cột danh sách, cho đổi khoảng. Theo mẫu lọc của `src/features/safe/safe-history-section.tsx` (date range from/to). Có nút reset về "7 ngày gần nhất".
- Auto-chọn báo cáo đầu danh sách (mới nhất) khi đổi khoảng.

### 3.4. UI — `ReportList` mỗi dòng hiển thị nạp két theo ngày
- Tiêu đề giữ **"Báo cáo theo ngày"**.
- Mỗi dòng (1 báo cáo):
  - Dòng trên: **`business_date`** (in đậm) + badge trạng thái (`Đã chốt` / `Đã hủy`).
  - Dòng dưới: **Nạp quỹ:** `Tiền mặt: {safe_deposit_amount} · Chuyển khoản: {bank_transfer_confirmed}` (dùng `formatVND`).
  - Chênh lệch (`difference`) giữ lại như thông tin hiện có (tone màu theo dấu).
  - Trạng thái **`voided`**: hiện badge "Đã hủy"; phần Nạp quỹ hiển thị **0** hoặc gạch mờ (vì khoản nạp đã bị đảo qua adjustment).
- Bấm dòng → cột phải hiển thị phiếu + In/Tải ảnh (giữ nguyên `loadCashCloseReport`/`PrintableReport`).

### 3.5. Không đổi
- `PrintableReport`, export JPEG, In: giữ nguyên.
- Các tab khác (Tồn kho, Doanh số, …): giữ nguyên.

## 4. Kiểm thử
- **pgTAP** cho `get_cash_close_reports_by_period`:
  - Trả đúng các ngày trong khoảng; loại ngày ngoài khoảng.
  - Thứ tự `business_date` DESC, cùng ngày `closed_at` DESC.
  - Gồm cả `final` và `voided`.
  - Lưu ý fixture: nếu test tạo nhiều report trong cùng transaction, đóng dấu `closed_at`/`created_at` lệch nhau để tie-break xác định (theo ghi chú dự án về `created_at` tie-break).
- **Test logic dòng nạp két** (unit/component): render `Tiền mặt`/`Chuyển khoản` đúng từ `safe_deposit_amount`/`bank_transfer_confirmed`; `voided` → 0.

## 5. Ngoài phạm vi (YAGNI)
- Bản mobile prototype `src/app/(preview)/mobile/_components/views/reports-view.tsx` (mock data) — không đụng.
- Không thêm dòng tổng gộp tất cả các ngày (chủ quán muốn tóm tắt **theo từng ngày**).
- Không đổi cách tính/ghi nạp quỹ ở backend (chỉ đọc field có sẵn).
- Không phân trang phức tạp; khoảng ngày + 7-ngày-mặc-định là đủ (báo cáo ~1/ngày).

## 6. Tiêu chí hoàn thành
- [ ] Tab Chốt két mặc định hiển thị **7 ngày gần nhất**, mới nhất trên đầu.
- [ ] Có bộ lọc khoảng ngày (từ → đến) đổi được; reset về 7 ngày.
- [ ] Mỗi dòng hiện **Nạp quỹ của ngày đó**: Tiền mặt + Chuyển khoản (`voided` → 0).
- [ ] Chọn dòng vẫn xem được phiếu + In/Tải ảnh như cũ.
- [ ] RPC `get_cash_close_reports_by_period` + pgTAP xanh.
- [ ] Không vỡ các tab báo cáo khác; mutation chốt/sửa/hủy vẫn tự refresh danh sách.
