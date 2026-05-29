# Spec — GSAP animation cho 8 màn còn lại (Chill Coffee ERP)

> Ngày: 2026-05-29 · Tiếp nối lớp animation đã dựng (foundation + Login + Dashboard).

## 1. Context (Bối cảnh)

Vòng trước đã dựng lớp animation GSAP tái dùng và áp dụng cho Login + Dashboard:
- `src/lib/gsap.ts` (đăng ký plugin, `DUR`, `STAGGER`), `src/lib/reduced-motion.ts` (`prefersReducedMotion()`).
- `<Reveal>` (`src/components/ui/reveal.tsx`): mặc định fade+rise; `stagger` (animate con trực tiếp); `onScroll` (`ScrollTrigger.batch`, once).
- `<CountUp>` (`src/components/ui/count-up.tsx`): đếm số, `value:number` + `format`.
- `src/app/page.tsx` đã bọc **mọi view** bằng `<Reveal key={view}>` → mọi màn (kể cả 8 màn này) **đã có fade entrance khi chuyển view**.

Spec này mở rộng animation **bên trong** 8 màn còn lại: **Reports, Inventory, Settings** (có tab) và **Cashflow, Cash, Safe, Shifts, Handover** (không tab). Mục tiêu: nhất quán với Dashboard, tinh tế/chuyên nghiệp, mượt 60fps, tôn trọng reduced-motion — **không** redesign visual.

## 2. Quyết định đã chốt

| Vấn đề | Quyết định |
|---|---|
| Phong cách | Tinh tế & chuyên nghiệp (150–400ms), polish + hiệu năng 60fps (kế thừa vòng trước) |
| Tab (Reports/Inventory/Settings) | Radix `TabsContent` **remount** khi đổi tab → bọc nội dung mỗi panel bằng `<Reveal duration={DUR.fast}>` → **fade lại mỗi lần đổi tab** |
| Phạm vi hiệu ứng | **Chỉ primitive sẵn có** (`<Reveal>` + `<CountUp>`). KHÔNG bespoke (không slide wizard, không check-mark, không pulse số dư) |
| Modal | Giữ nguyên animation Radix mặc định |
| Chart (Recharts) | Giữ animation native, KHÔNG đụng |

## 3. Guardrails (RÀNG BUỘC UX — phần quan trọng nhất)

Đây là các quy tắc khiến spec "thông minh" thay vì "animate mọi thứ". Áp dụng tuyệt đối:

1. **`<CountUp>` CHỈ cho số đã "settle"** (load từ server / cập nhật khi đóng modal). **TUYỆT ĐỐI KHÔNG** cho số cập nhật real-time khi user gõ:
   - ❌ Cash: tổng đối soát (`posTotal/physical/difference`), tổng wizard (`todayTotal/nextDayTotal/safeDepositPreview`) — đổi theo từng phím gõ ở lưới mệnh giá → CountUp sẽ re-animate liên tục = hỏng UX. Giữ text thường.
   - ✅ Được: opening cash (Cash), số dư (Safe), tổng lương (Shifts), KPI in/out/net (Cashflow), 4 đếm kho (Inventory dashboard), KPI giờ (Reports).
2. **KHÔNG `stagger` entrance trên phần tử tương tác/nhập liệu**: lưới mệnh giá (Cash), ma trận checkbox sidebar (Settings), các form nhiều input (KiotViet config, Shift bonus). → để chúng hiện theo fade chung (view/panel), không animate riêng từng input (tránh chặn focus/gõ).
3. **Bảng `<table>`**: `<Reveal>` render `<div>` nên **không bọc `<tbody>`/`<tr>`** (sai HTML). → bọc **cả bảng/Card** bằng `<Reveal onScroll>` (reveal nguyên khối khi cuộn tới), KHÔNG reveal từng dòng.
4. **KHÔNG `onScroll`-ẩn các control tương tác** (DateRangePicker, ListToolbar search/sort, nút). → chỉ bọc vùng bảng/list, để control hiện ngay.
5. **List cập nhật động (mutation)**: entrance chỉ chạy **lúc mount** (`<Reveal>` dùng `useGSAP` không deps → chạy 1 lần; re-render do mutation không re-trigger). An toàn cho employee-grid, payroll.
6. **Reduced-motion**: tự động qua primitive (đã có) — không cần thêm.

## 4. Bổ sung primitive (tối thiểu)

- Thêm prop tùy chọn **`duration?: number`** vào `<Reveal>` (mặc định `DUR.base`). Tab panel dùng `<Reveal duration={DUR.fast}>` để fade nhanh (~200ms) mỗi lần đổi tab.
- Không thêm gì khác (giữ API tối thiểu — karpathy).

## 5. Quy tắc áp dụng theo loại màn

**Màn có tab (Reports, Inventory, Settings):**
- Bọc nội dung **mỗi** `<TabsContent>` bằng `<Reveal duration={DUR.fast}>` → entrance = fade panel mỗi lần activate.
- Bên trong panel: chỉ thêm `<CountUp>` cho số đã settle + `<Reveal onScroll>` cho bảng/list dài. **KHÔNG** thêm `<Reveal stagger>` trong panel (tránh chồng animation với fade panel).

**Màn không tab (Cashflow, Cash, Safe, Shifts, Handover):**
- Áp như Dashboard: `<Reveal stagger>` cho lưới KPI/card, `<CountUp>` cho số settle, `<Reveal onScroll>` cho list lịch sử dài. (View-entry fade đã có sẵn ở `page.tsx`.)

## 6. Chi tiết theo màn

### 6.1 Reports — `src/features/reports/reports-view.tsx` (5 tab Radix)
Bọc nội dung mỗi tab bằng `<Reveal duration={DUR.fast}>`. Bên trong:

| Tab | Surface (file) | Primitive |
|---|---|---|
| Chốt két | `report-list.tsx` (`<ul>` card buttons) | (panel fade là đủ; PrintableReport để in → bỏ qua) |
| Tồn kho | `consumption-report.tsx`, `variance-audit-report.tsx` | `<Reveal onScroll>` quanh mỗi Card bảng |
| Doanh số | `product-summary-table.tsx`, `category-summary-table.tsx` | `<Reveal onScroll>` quanh mỗi Card bảng |
| Chi phí+lương | `expense-by-category-table.tsx`, `payroll-summary-table.tsx` | `<Reveal onScroll>` quanh mỗi Card bảng |
| Theo giờ | `hourly-kpi-row.tsx`: `totalRevenue`→`<CountUp format={formatVND}>`, `totalOrders`→`<CountUp format={n=>n.toLocaleString("vi-VN")}>`; `hourly-bar-chart.tsx` | CountUp; chart để native |

### 6.2 Inventory — `src/features/inventory/inventory-view.tsx` (5 tab Radix)
Bọc mỗi tab bằng `<Reveal duration={DUR.fast}>`. Bên trong:

| Tab | Surface (file) | Primitive |
|---|---|---|
| Stock | `stock-balance-list.tsx` (card list), `stock-ledger-section.tsx` (list) | `<Reveal onScroll>` quanh vùng list (không bọc ListToolbar) |
| Ingredients / Menu / Recipes | card list `space-y-2` mỗi tab | `<Reveal onScroll>` quanh vùng list |
| Dashboard (analytics) | `inventory-kpi-row.tsx` (4 StatCard: activeCount/lowStockCount/negativeCount/weeklySaleCount) | 4× `<CountUp format={n=>String(n)}>` |
| Dashboard | `low-stock-list.tsx`, `negative-balance-list.tsx`, `top-consumption-list.tsx` (card list) | `<Reveal onScroll>` quanh mỗi list |

### 6.3 Settings — `src/features/settings/settings-view.tsx` (2 tab Radix)
Bọc mỗi tab bằng `<Reveal duration={DUR.fast}>`. Bên trong:

| Khu vực (file) | Primitive |
|---|---|
| `accounts-manager-card.tsx`, `signup-requests-card.tsx` (bảng) | `<Reveal onScroll>` quanh Card bảng |
| `kiotviet-config-form.tsx`, `shift-bonus-config-form.tsx`, ma trận checkbox trong `sidebar-config-form.tsx` | **KHÔNG** animate input (guardrail #2) — panel fade là đủ |
| `handover-default-tasks-editor.tsx` (task list), danh sách override user trong `sidebar-config-form.tsx` | `<Reveal onScroll>` quanh list (không bọc ô nhập "thêm mục") |
| `backup-restore-section.tsx`: `HistoryPanel` (bảng) | `<Reveal onScroll>` quanh bảng history |

### 6.4 Cashflow — `src/features/cashflow/cash-flow-view.tsx` (không tab)
| Surface (file) | Primitive |
|---|---|
| `cash-flow-kpi-bar.tsx` (lưới 3 KpiCard: in/out/net) | `<Reveal stagger>` quanh lưới + 3× `<CountUp format={formatVND}>` |
| `cash-flow-chart.tsx` | để native |
| `expense-breakdown-table.tsx` (bảng) | `<Reveal onScroll>` quanh Card bảng (phần mở rộng giữ CSS) |
| `lunar-calendar-widget.tsx` (lưới 7×7) | `<Reveal>` cả widget (KHÔNG stagger 49 ô) |

### 6.5 Cash — `src/features/cash/cash-view.tsx` (không tab) — CẨN TRỌNG
| Surface (file) | Primitive |
|---|---|
| Opening cash (`cash-view.tsx`) | `<CountUp format={formatVND}>` (settle khi load/đóng modal) |
| `reconciliation-summary.tsx`, `cash-count-wizard.tsx` (tổng real-time) | ❌ KHÔNG CountUp (guardrail #1) — giữ text |
| `denomination-grid.tsx` (lưới input) | ❌ KHÔNG stagger (guardrail #2) |
| `cash-history-section.tsx` (card list lịch sử) | `<Reveal onScroll>` |

### 6.6 Safe — `src/features/safe/safe-view.tsx` (không tab)
| Surface (file) | Primitive |
|---|---|
| `safe-balance-card.tsx` (số dư) | `<CountUp format={formatVND}>` (settle khi đóng modal) |
| `safe-history-section.tsx` (`DataTable`) | `<Reveal onScroll>` quanh bảng |

### 6.7 Shifts — `src/features/shifts/shifts-view.tsx` (không tab)
| Surface (file) | Primitive |
|---|---|
| `payroll-history-card.tsx` (tổng lương) | `<CountUp format={formatVND}>` |
| `employee-grid.tsx` (card list active/inactive) | `<Reveal stagger>` mỗi list (chỉ mount; guardrail #5) |
| `payroll-history-card.tsx` (list `<ul>`) | `<Reveal stagger>` hoặc `onScroll` |

### 6.8 Handover — `src/features/handover/handover-view.tsx` (không tab)
| Surface (file) | Primitive |
|---|---|
| `handover-checklist.tsx` (card list `space-y-2`) | `<Reveal stagger>` (entrance; KHÔNG check-mark bespoke) |
| Header/progress, `handover-shifts-summary.tsx`, `handover-note-editor.tsx` | ride view-entry fade (tùy chọn `<Reveal>` cả section) |

## 7. Hiệu năng & Accessibility

- Chỉ `transform`/`opacity` (autoAlpha); list/bảng dùng `ScrollTrigger.batch` (once) → không tạo hàng loạt tween.
- Tab remount: `useGSAP` cleanup tự revert ScrollTrigger/tween của panel cũ → không leak.
- Reduced-motion: tự động qua primitive.

## 8. Ngoài phạm vi

- Bespoke (slide wizard Cash, check-mark Handover, pulse số dư Safe), nâng cấp modal vượt Radix, animate input form, count-up số real-time, reveal từng `<tr>` trong `<table>`.

## 9. Kiểm thử (xác minh)

1. `npm run build` — type-check (`duration?` prop) + SSR an toàn.
2. `npm run test:run` — suite hiện có vẫn xanh (141). (Component vẫn theo quy ước repo: hoãn unit-test → verify bằng build + trình duyệt.)
3. Trình duyệt `npm run dev` (cần đăng nhập): đổi tab Reports/Inventory/Settings thấy fade nhanh mỗi lần; KPI Cashflow/Inventory đếm số; list dài scroll-reveal; **Cash: tổng đối soát KHÔNG nhảy khi gõ mệnh giá**; bật `prefers-reduced-motion` → tắt animation, nội dung hiện đủ.
4. Spot-check 60fps + console sạch (chrome-devtools MCP).
