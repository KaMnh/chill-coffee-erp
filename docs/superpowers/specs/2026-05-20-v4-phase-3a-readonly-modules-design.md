# Phase 3A — Read-only Modules + AppShell Design Spec

> **Status:** Approved 2026-05-20
> **Master plan:** `C:\Users\RAZER 15\.claude\plans\c-c-c-file-handoff-shimmering-kahan.md` §5 Phase 3A
> **Implements:** Dashboard, Reports, Pivot + AppShell + Login (3 read-only modules + shell)

---

## 1. Mục tiêu

Port + redesign 3 module **chỉ-đọc** (rủi ro thấp nhất trong v3) bằng design system Phase 2, đồng thời dựng lại tầng **AppShell** (auth lifecycle, role gate, business-date, realtime, POS sync) bằng cách tách v3 `page.tsx` (610 dòng) thành các đơn vị nhỏ test-friendly. Verification cuối phase: **dump dữ liệu production v3 offline → restore vào Supabase v4 dev → đối chiếu số liệu khớp 1:1**.

Kết thúc Phase 3A, user (owner/manager/staff_operator/employee_viewer) đăng nhập v4 dev sẽ thấy Dashboard, Reports, Pivot hoạt động như v3, **không thay đổi backend**, **không lệch số liệu**.

---

## 2. Quyết định đã chốt (brainstorming 2026-05-20)

| Vấn đề | Lựa chọn |
|---|---|
| **AppShell decomposition** | Strict split — `page.tsx` ~80 dòng = thin router. Hooks tách: `useAuthSession`, `useBusinessDate`, `useRoleGate`, `usePosSync`. Realtime đã có sẵn ở Phase 1 (`useRealtimeInvalidate`). AppShell/Sidebar/TopBar Phase 2 = pure UI. |
| **Verification** | Lúc 3A cuối phase: `pg_dump` v3 offline 1 lần (giờ quán đóng) → restore vào Supabase v4 dev local → script đối chiếu dashboard/pivot/reports khớp tuyệt đối với v3 cùng `business_date`. |
| **Login screen** | Port nguyên hành vi v3 (email + password + viewer self-signup) — chỉ đổi style theo Phase 2 tokens. Self-signup ở lại login screen, không dời sang Phase 3C. |

---

## 3. Phạm vi (Scope)

### Trong phạm vi
- **AppShell**: layout chính (Sidebar + TopBar + content) lắp ráp các hook + 3 view dưới.
- **Auth flow**: login + viewer self-signup; session lifecycle.
- **Role gate**: port `navigation.ts` (8 view × 4 role) verbatim.
- **Business-date picker**: state ở AppShell, truyền xuống cả 3 view.
- **Realtime invalidate**: tái dùng hook `useRealtimeInvalidate` (Phase 1) không động đến.
- **POS sync**: hook + nút trigger ở TopBar gọi `/api/kiotviet/sync`.
- **Dashboard view**: bento grid với 5 KPI (POS / cash / expense / payroll / active shifts) + nhật ký chi phí + handover panel (read-only ở 3A).
- **Reports view**: list các cash-close-report + viewer + nút "Tải JPEG" (dynamic import `html-to-image`).
- **Pivot view**: bảng `DataTable` doanh thu sản phẩm KiotViet (từ `dashboard.sales_orders`).
- **Verification gate**: script `tools/verify-mirror.mjs` so sánh số liệu v3 ↔ v4 trên dump.

### NGOÀI phạm vi (đẩy sang phase sau)
- Module ghi tiền (cash close, shifts/payroll, expenses CRUD) → Phase 3B.
- Module owner-only (safe ledger, settings, handover wizard write) → Phase 3C.
- Module mới (inventory, analytics) → Phase 4–5.
- Tests tự động phủ Vitest/pgTAP/Playwright → Phase 6.
- 4 lazy modals của v3 (`ChecklistEditor`, `HandoverWizard`, `SafeManager`, `SettingsManager`) → mount chỗ trống/lock placeholder, mở rộng ở Phase 3B/3C.

---

## 4. Kiến trúc

### 4.1 Tổng quan

```
src/app/page.tsx (thin router, ~80 lines)
  └─ useAuthSession()        → { account, status, signOut }
  └─ useBusinessDate()       → { businessDate, setBusinessDate }
  └─ useRoleGate(account)    → { visibleNav, canSee(key) }
  └─ usePosSync()            → { sync, status, lastError }
  └─ useRealtimeInvalidate() → side effect (existing)

  render:
    if !account → <LoginScreen />
    else → <AppShell sidebar={<Sidebar/>} topBar={<TopBar/>}>
             {view === "dashboard" && <DashboardView/>}
             {view === "reports"   && <ReportsView/>}
             {view === "pivot"     && <PivotView/>}
             {/* 3B/3C views render placeholder/locked */}
           </AppShell>
```

### 4.2 File structure

```
src/
  app/
    page.tsx                              [NEW thin router]
    login/
      page.tsx                            [NEW separate route]
  hooks/
    use-auth-session.ts                   [NEW]
    use-business-date.ts                  [NEW]
    use-role-gate.ts                      [NEW]
    use-pos-sync.ts                       [NEW]
    queries/use-realtime-invalidate.ts    [Phase 1 — untouched]
  features/
    navigation/
      navigation.ts                       [PORT from v3 features/navigation.ts]
    auth/
      login-screen.tsx                    [PORT+REDESIGN from v3 login-panel.tsx]
    dashboard/
      dashboard-view.tsx                  [PORT+REDESIGN]
      kpi-bar.tsx                         [NEW — split out 5-KPI bar]
      shortcut-grid.tsx                   [NEW — 5 quick-action buttons]
      expense-log-card.tsx                [NEW — today's expense list]
      sales-feed-card.tsx                 [NEW — recent KiotViet orders]
      store-status-card.tsx               [NEW — active staff/last sync]
      handover-panel.tsx                  [PORT+REDESIGN, read-only in 3A]
    reports/
      reports-view.tsx                    [PORT+REDESIGN]
      report-list.tsx                     [NEW — split out left list]
      printable-report.tsx                [PORT from v3 shared/]
      export-jpeg.ts                      [NEW — html-to-image helper]
    pivot/
      pivot-view.tsx                      [PORT+REDESIGN with DataTable]
  components/ui/                          [Phase 2 — untouched]
  lib/data/                               [Phase 1 — untouched]
tools/
  verify-mirror.mjs                       [NEW — Phase 3A gate]
```

**Untouched** (Phase 1 ported, Phase 2 ported): `src/lib/data/**`, `src/lib/kiotviet/**`, `src/lib/supabase/**`, `src/lib/{datetime,format,validation,types}.ts`, `src/hooks/queries/**`, `src/middleware.ts`, `src/app/api/**`, `database/**`, `src/components/{ui,layout,charts}/**`.

### 4.3 Hooks contracts

Mỗi hook một file, signature gọn, test được độc lập.

**`useAuthSession()`** — wrap Supabase auth, expose React state.
```ts
type AuthStatus = "loading" | "authed" | "unauthed";
interface UseAuthSessionResult {
  status: AuthStatus;
  account: AccountWithRole | null;  // existing type from Phase 1
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  signupViewer(email: string, password: string, fullName: string): Promise<void>;
}
function useAuthSession(): UseAuthSessionResult;
```

**`useBusinessDate()`** — single source of truth cho `business_date` toàn app (mặc định = `today()` từ `lib/datetime.ts`).
```ts
interface UseBusinessDateResult {
  businessDate: string;  // YYYY-MM-DD
  setBusinessDate(date: string): void;
  resetToToday(): void;
}
function useBusinessDate(): UseBusinessDateResult;
```

**`useRoleGate(account)`** — port logic từ v3 `navigation.ts`, expose state-friendly version.
```ts
interface UseRoleGateResult {
  visibleNav: ReadonlyArray<NavItem>;
  canSee(key: ViewKey): boolean;
  defaultView: ViewKey;  // first item in visibleNav, fallback "dashboard"
}
function useRoleGate(account: AccountWithRole | null, settings?: AppSettings): UseRoleGateResult;
```

**`usePosSync()`** — gọi `/api/kiotviet/sync` qua TanStack mutation, expose trạng thái cho TopBar nút "Đồng bộ POS".
```ts
type PosSyncStatus = "idle" | "syncing" | "success" | "error";
interface UsePosSyncResult {
  status: PosSyncStatus;
  lastSyncedAt: string | null;
  lastError: string | null;
  sync(): Promise<void>;
}
function usePosSync(): UsePosSyncResult;
```

### 4.4 Data flow

```
Login screen
  ↓ signIn() → Supabase Auth
  ↓ useAuthSession ← session.onAuthStateChange → set account
  ↓
AppShell
  ↓ useBusinessDate → businessDate state
  ↓ useRoleGate(account) → visibleNav, canSee
  ↓ usePosSync → TopBar button state
  ↓ useRealtimeInvalidate (Phase 1) → invalidates queries on DB change
  ↓
DashboardView
  ↓ useDashboardQuery(supabase, businessDate)  [Phase 1 hook]
  ↓     → loadDashboard → RPC dashboard_daily_ops → DashboardData
  ↓ useHandoverQuery(supabase, businessDate)
  ↓ useShiftsQuery(supabase, businessDate)
  ↓
ReportsView
  ↓ useReportsQuery(supabase, businessDate)  [Phase 1 hook]
  ↓     → loadCashCloseReportsByDate → RPC → CashCloseReport[]
  ↓ loadCashCloseReport(reportId) on select
  ↓ export click → dynamic import html-to-image → JPEG download
  ↓
PivotView
  ↓ reuse data từ useDashboardQuery (sales_orders[])
  ↓ render DataTable<SalesOrder>
```

### 4.5 Phase 2 component mapping

| v3 element | v4 component |
|---|---|
| sidebar (CSS thuần) | `<Sidebar>` + `<NavItem>` + `<SidebarLogo>` (Phase 2) |
| top bar (inline) | `<TopBar>` + business-date `<Select>` + POS sync `<IconButton>` + account `<Avatar>` |
| 5 KPI cards | `<StatCard color="peach|blue|mint|lilac|...">` (Phase 2) |
| expense list row | `<ListItem>` (Phase 2) |
| sales order table | `<DataTable<SalesOrder>>` (Phase 2) |
| report list | custom — `<ListItem>` rows wrapped in `<Card>` |
| report viewer | port `<PrintableReport>` (v3 logic untouched, style tokenized) |
| handover checklist | `<Checkbox>` × N + `<ProgressBar>` |
| empty states | `<EmptyState>` (Phase 2) |
| login form | `<Card>` + `<TextField>` × 3 + `<Button>` + `<AlertBanner>` |
| loading | `<Spinner>` / `<Skeleton>` (Phase 2) |
| toast feedback | `<Toast>` + `useToast()` (Phase 2) |

### 4.6 Error handling
- **Auth errors** (invalid credentials, network) → `AlertBanner variant="danger"` trên login screen.
- **Missing Supabase config** → toàn-app fallback (port từ v3 lines 271-285).
- **Query errors** → `useToast({ semantic: "danger" })` + giữ data cũ; **không** crash app.
- **POS sync errors** → TopBar button status="error" + `Toast` showing error message.
- **JPEG export failure** → `Toast({ semantic: "danger", message: "Không xuất được ảnh báo cáo" })`.
- **Empty data states** → `<EmptyState icon="alertCircle" title="Chưa có dữ liệu ..." />`.

---

## 5. Login flow

### 5.1 UX (port từ v3, restyle Phase 2)

```
┌─────────────────────────────────────┐
│  [Logo + "Chill Coffee Garden"]     │
│                                     │
│  Email     [__________]             │
│  Mật khẩu  [__________]             │
│  [Đăng nhập]                        │
│                                     │
│  ─────  hoặc đăng ký xem  ─────     │
│                                     │
│  Họ tên    [__________]             │
│  Email     [__________]             │
│  Mật khẩu  [__________]             │
│  [Gửi yêu cầu đăng ký]              │
│                                     │
│  (AlertBanner errors nếu có)        │
└─────────────────────────────────────┘
```

- 2 form gộp 1 card. Tab/section split bằng `<Tabs>` (Phase 2) hoặc divider — quyết định cuối ở plan.
- Self-signup tạo `auth.user` + insert `signup_requests` (chờ owner approve ở settings) — y hệt v3.
- Sau login thành công → redirect về `/` → AppShell render Dashboard mặc định.

### 5.2 Vì sao `/login` riêng route?
Phase 1 `page.tsx` đang là stub (Phase 1 Task 2). Tách `/login` route thay vì conditional render giúp:
1. Middleware (Phase 1) đã sẵn rule redirect; ta tận dụng được.
2. URL `/login` semantic, người dùng bookmark được.
3. SEO / favicon / metadata riêng nếu cần (không cần ngay).

---

## 6. Dashboard module

### 6.1 Layout (bento grid)

```
┌─────────────────────────────────────────────────────────────┐
│  [KpiBar: 5 StatCard peach/blue/mint/lilac/peach]           │
├──────────────────────┬──────────────────────────────────────┤
│  [Shortcut grid]     │  [Handover panel]                    │
│  5 quick actions     │  Checklist + notes (read-only 3A)    │
├──────────────────────┼──────────────────────────────────────┤
│  [Expense log]       │  [Sales feed]                        │
│  Today's 4 expenses  │  Last 5 KiotViet orders + total      │
│                      │                                      │
│  [Store status]      │                                      │
│  Active staff /      │                                      │
│  last sync info      │                                      │
└──────────────────────┴──────────────────────────────────────┘
```

Mobile (<768px): single column, KpiBar horizontal-scroll.

### 6.2 5 KPI

| Tên | Field | Color | Format |
|---|---|---|---|
| Thu POS | `dashboard.total_sales - dashboard.cash_sales` | peach | currency VND |
| Thu tiền mặt | `dashboard.cash_sales` | blue | currency VND |
| Tổng chi hôm nay | `dashboard.total_expenses` | lilac | currency VND |
| Lương đã phát | `dashboard.payroll_paid` | mint | currency VND |
| Ca đang mở | `dashboard.active_staff` | peach | integer (người) |

> Note: "Thu POS" = non-cash sales (chuyển khoản, thẻ, MoMo …). Công thức `total_sales - cash_sales` khớp v3 `MetricsBar`.

### 6.3 5 Shortcut actions

Chỉ button — click chuyển view sang module tương ứng (3B/3C). Trong Phase 3A chưa có module đích → click hiển thị `Toast({ semantic: "info", message: "Tính năng sẽ có ở Phase 3B" })`.

1. ➕ Ghi chi phí → /expenses
2. 🕐 Check-in/out ca → /shifts
3. 💵 Kiểm két nhanh → /cash
4. 🔒 Chốt két → /cash
5. 🖨️ In báo cáo → /reports

### 6.4 Handover panel (read-only 3A)

- Render `handover_tasks` từ `loadHandover()` (Phase 1 sẵn).
- Checkbox: render disabled (`<Checkbox disabled />`) với state hiện tại.
- Note textarea: render `readOnly` với value hiện tại.
- Banner "Mở wizard handover ở Phase 3C" → `AlertBanner variant="info"`.
- Toàn bộ mutation (toggle task / edit note) → defer Phase 3C.

---

## 7. Reports module

### 7.1 Layout
```
┌────────────────────┬────────────────────────────────────────┐
│  [Report list]     │  [Report viewer]                       │
│  - 19/05 ✓ +0      │   PrintableReport (full A4 view)       │
│  - 18/05 ⚠ -50k    │                                         │
│  - 17/05 ✓ +0      │   [Tải JPEG]  [In]                     │
│  - 16/05 ✗ void    │                                         │
│  ...               │                                         │
└────────────────────┴────────────────────────────────────────┘
```

- Left: `<ListItem>` rows trong `<Card>`. Active row highlighted.
- Right: `<PrintableReport>` (port v3) render trong `<div ref={printRef}>`.
- Buttons: "Tải JPEG" + "In" trong `<CardFooter>`.

### 7.2 JPEG export

```ts
// src/features/reports/export-jpeg.ts
export async function exportReportAsJpeg(
  element: HTMLElement,
  filename: string
): Promise<void> {
  const { toJpeg } = await import("html-to-image");
  const dataUrl = await toJpeg(element, {
    quality: 0.95,
    backgroundColor: "#ffffff",
    pixelRatio: 2,
    cacheBust: true,
  });
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
```

Dynamic import giữ `html-to-image` ngoài main bundle.

### 7.3 Report status badges
- `closed` → `<Badge variant="soft" semantic="success">Đã chốt</Badge>`
- `voided` → `<Badge variant="soft" semantic="danger">Đã hủy</Badge>`
- `pending` (nếu có) → `<Badge variant="soft" semantic="warning">Đang chờ</Badge>`
- Difference > 0 → màu `success`; < 0 → `danger`; = 0 → `muted`.

---

## 8. Pivot module

### 8.1 Layout

```
┌──────────────────────────────────────────────────────────────┐
│  Doanh thu sản phẩm — 19/05/2026                             │
│  [Tổng: 1.250.000đ — 24 hóa đơn]                              │
├────────────┬────────────┬────────────┬──────────────┬────────┤
│ Hóa đơn ↕  │ Người bán ↕│ Thanh toán │ Doanh thu ↕  │        │
├────────────┼────────────┼────────────┼──────────────┼────────┤
│ HD-001     │ Linh       │ Tiền mặt   │ 85.000đ      │        │
│ HD-002     │ Linh       │ Thẻ        │ 120.000đ     │        │
│ ...        │            │            │              │        │
└────────────┴────────────┴────────────┴──────────────┴────────┘
```

- `<DataTable<SalesOrder>>` (Phase 2) với 4 cột.
- Header card: `<Card>` với tổng doanh thu + số hóa đơn (đếm từ `sales_orders.length`).
- Empty state: `<EmptyState icon="alertCircle" title="Chưa có hóa đơn cho ngày này" />`.

### 8.2 Data source
Đã có trong `dashboard.sales_orders` (Phase 1 `loadDashboard` trả về). Không cần query mới — Pivot chia sẻ data với Dashboard.

```ts
const { data: dashboard } = useDashboardQuery(supabase, businessDate);
const salesOrders = dashboard?.sales_orders ?? [];
```

### 8.3 Cột DataTable

| Key | Header | Sort? | Format |
|---|---|---|---|
| `invoice_code` | Hóa đơn | yes | text |
| `sold_by_name` | Người bán | yes | text |
| `payment_method` | Thanh toán | no | text (map: "cash"→"Tiền mặt", "card"→"Thẻ", "transfer"→"Chuyển khoản", "other"→giữ nguyên) |
| `net_amount` | Doanh thu | yes | currency VND |

---

## 9. Role gate (port verbatim từ v3)

File `src/features/navigation/navigation.ts` (port nguyên từ v3 `src/features/navigation.ts`, không sửa logic):

```ts
export type ViewKey = "dashboard" | "expenses" | "shifts" | "cash" | "safe"
                    | "reports" | "pivot" | "settings";

export type Role = "owner" | "manager" | "staff_operator" | "employee_viewer";

interface NavItem {
  key: ViewKey;
  label: string;       // Vietnamese
  icon: IconName;      // mapped to Phase 2 icons.tsx
  roles: ReadonlyArray<Role>;
}

export const NAV_ITEMS: ReadonlyArray<NavItem>;
export const DEFAULT_SIDEBAR_BY_ROLE: Record<Role, ReadonlyArray<ViewKey>>;
export function getVisibleNav(account, settings?): ReadonlyArray<NavItem>;
export function canSee(account, key, settings?): boolean;
```

Trong Phase 3A: chỉ 3 view (`dashboard`, `reports`, `pivot`) có implementation thực. 5 view còn lại render placeholder lock — nav item vẫn hiện theo role nhưng click sẽ thấy `<EmptyState>` báo "Module này sẵn sàng ở Phase 3B/3C".

---

## 10. Verification strategy

### 10.1 Cuối phase: mirror v3 → v4

**Bước 1 — Snapshot offline (1 lần, người vận hành chạy thủ công khi quán đóng):**
```bash
# Trên máy chạy v3 LIVE, giờ quán đóng (~23:00)
docker exec v3-postgres pg_dump \
  -U postgres -d postgres \
  --schema=public --schema=auth --schema=storage \
  -f /tmp/v3-mirror-2026-05-XX.sql
docker cp v3-postgres:/tmp/v3-mirror-2026-05-XX.sql \
  ./mirrors/v3-mirror-2026-05-XX.sql
```

> `.gitignore` thêm `mirrors/` — dump có dữ liệu thật.

**Bước 2 — Restore vào v4 dev (Supabase self-hosted local):**
```bash
docker compose stop chill-app  # tránh ghi đè trong lúc restore
docker compose exec db psql -U postgres -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker compose exec -T db psql -U postgres < mirrors/v3-mirror-2026-05-XX.sql
docker compose start chill-app
```

**Bước 3 — Đối chiếu bằng script:**
```bash
node tools/verify-mirror.mjs --date 2026-05-XX
```

Script gọi:
- `loadDashboard(anonClient, businessDate)` trên v4
- `SELECT * FROM dashboard_daily_ops(date) /* on v3 dump separately */` để có baseline
- So sánh: `total_sales`, `cash_sales`, `total_expenses`, `payroll_paid`, `active_staff`, `length(sales_orders)`, `length(expenses)`.
- Pass: tất cả giá trị bằng nhau (tolerance 0 — phải khớp tuyệt đối vì RPC giống nhau).
- Fail: in diff per field + exit 1.

**Bước 4 — Smoke UI:**
- Login owner → Dashboard show số khớp với output bước 3.
- Click vào Reports → list trùng số report của ngày đó trong v3.
- Click vào Pivot → đếm hóa đơn = `length(sales_orders)`.

### 10.2 Test biên timezone (in-phase, không cần mirror)

Trong từng task, mỗi khi có `business_date` trên UI:
- Set `businessDate = "2026-05-19"` lúc 23:30 PM giờ máy → Dashboard hiển thị KPI cho 19/05, không phải 20/05 (do TZ Asia/Ho_Chi_Minh).
- Set `businessDate = "2026-05-19"` lúc 05:30 AM → vẫn 19/05.

Bẫy timezone đã được Phase 1 cover ở DB (`ALTER DATABASE ... SET timezone`) + `src/lib/datetime.ts`. Ta chỉ phải dùng đúng helper, không tự `new Date()`.

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `page.tsx` 610 dòng v3 quá phức tạp để hiểu đầy đủ trước khi chia | Mỗi hook 1 task riêng — implement + test (smoke) trước khi compose vào AppShell |
| Người vận hành quên rằng v3 đang LIVE và chạy dump nhầm vào DB v3 | Hướng dẫn dump phải nói rõ "máy v3", "container v3-postgres" và yêu cầu chạy `--inserts` flag để đảm bảo file SQL chỉ chứa INSERT (không có DROP/CREATE) **+ verify file có dòng `CREATE SCHEMA` trước khi apply** |
| `html-to-image` v3 hành vi khác với phiên bản v4 (dynamic import) | Pin `html-to-image@1.11.x` (giống v3). Test JPEG export trên 1 báo cáo thật trước khi đóng phase. |
| Strict-split tạo nhiều files nhỏ → khó tìm | File structure rõ trong §4.2; mỗi hook 1 trách nhiệm; folder `features/<module>/` gom theo domain |
| Realtime invalidate không hoạt động sau restore mirror | Sau restore, `db-init.mjs` (Phase 1) re-run sẽ tái tạo publication; alternative: `SELECT pg_create_logical_replication_slot(...)` if needed. Test smoke includes "ghi 1 expense fake → dashboard tự refresh". |
| Pivot chỉ có 4 cột → quá đơn giản với DataTable | YAGNI. Khi cần thêm cột (product_name, quantity, …) ở phase analytics, bổ sung lúc đó. |

---

## 12. Definition of Done (Phase 3A)

- [ ] Login đăng nhập được với owner + 1 staff seed account.
- [ ] AppShell render đúng nav theo role (owner thấy 8 item, staff thấy 5, viewer thấy 1).
- [ ] Dashboard: 5 KPI cards hiển thị, expense log, sales feed, store status, handover panel (read-only) hoạt động.
- [ ] Reports: list report theo ngày, click vào hiển thị PrintableReport, "Tải JPEG" download được file ảnh.
- [ ] Pivot: DataTable hiển thị sales_orders với 4 cột, empty state khi không có dữ liệu.
- [ ] Business-date picker ở TopBar thay đổi → toàn bộ data của 3 view re-fetch.
- [ ] POS sync button ở TopBar bấm → gọi `/api/kiotviet/sync` và hiển thị toast trạng thái.
- [ ] Verification mirror: script `tools/verify-mirror.mjs --date <ngày>` exit 0 sau khi restore dump v3 vào v4 dev.
- [ ] Build sạch: `npm run build` không warning/error, TypeScript strict.
- [ ] Code review hai-tầng: spec compliance ✓ + code quality ✓.
- [ ] Branch `phase-3a-readonly` merged về `main`, tag `v4-phase-3a`.

---

## 13. References

- **v3 source** (port-from):
  - `F:\Chill manager\v3\src\app\page.tsx` — 610 dòng AppShell
  - `F:\Chill manager\v3\src\features\navigation.ts` — 61 dòng role gate
  - `F:\Chill manager\v3\src\features\auth\login-panel.tsx` — 81 dòng
  - `F:\Chill manager\v3\src\features\dashboard\dashboard-view.tsx` — 136 dòng
  - `F:\Chill manager\v3\src\features\dashboard\handover-panel.tsx` — 93 dòng
  - `F:\Chill manager\v3\src\features\reports\reports-panel.tsx` — 138 dòng
  - `F:\Chill manager\v3\src\features\pivot\pivot-view.tsx` — 43 dòng
- **Phase 1 (ported, untouched)**:
  - `src/lib/data/{dashboard,reports,_common}.ts`
  - `src/hooks/queries/{use-dashboard-query,use-cash-queries,use-handover-query,use-shift-queries,use-account-query,use-realtime-invalidate}.ts`
  - `src/middleware.ts`, `src/app/api/**`
- **Phase 2 (design system)**: 35 components dưới `src/components/{ui,layout,charts}`
- **Master plan**: `C:\Users\RAZER 15\.claude\plans\c-c-c-file-handoff-shimmering-kahan.md`
