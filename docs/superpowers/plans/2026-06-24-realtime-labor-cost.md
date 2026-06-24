# Chi phí lương real-time (tạm tính) trên Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay thẻ KPI "Lương đã phát" trên Dashboard bằng "Lương hôm nay (tạm tính)" — một con số tự tăng real-time = lương đã chốt hôm nay (mọi hình thức trả) + lương đang phát sinh của người đang trong ca.

**Architecture:** Một hàm thuần `computeLiveLaborCost` (test bằng Vitest) làm toàn bộ phép tính. Dữ liệu (1) tổng lương đã chốt mọi method, (2) danh sách ca đang mở kèm rate, (3) `shift_bonus_config` được trả về **trong payload RPC `dashboard_daily_ops`** (security definer) — KHÔNG query thẳng bảng `shift_*` ở client, vì `employee_viewer` xem được dashboard nhưng RLS chặn đọc trực tiếp `shift_assignments`/`shift_payroll_records` (xem "Quyết định thiết kế"). Hook `useLiveLaborCost` chạy timer 60s cập nhật `now` → gọi hàm thuần. Realtime: subscribe `postgres_changes` cho 2 bảng ca/lương → invalidate query dashboard, theo đúng pattern hiện có.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript · Supabase (Postgres local, RPC security definer + Realtime publication) · TanStack Query · Vitest.

---

## Quyết định thiết kế (đọc trước — quan trọng cho review)

**Vì sao đưa dữ liệu vào RPC `dashboard_daily_ops` thay vì query thẳng bảng ở client?**

Spec §3.2 cho 2 lựa chọn cho dữ liệu (1)/(2)/(3): *"thêm trường mới vào payload dashboard (vd `payroll_total_all`) hoặc một query nhẹ riêng"*. Plan chọn **payload RPC** vì lý do đúng-đắn theo role:

- RLS (`database/003_rls.sql:138,145`): `shift_assignments`/`shift_payroll_records` chỉ cho SELECT khi `app_is_staff_or_above()` = role ∈ {owner, manager, staff_operator}. **`employee_viewer` KHÔNG đọc được.**
- Nhưng `employee_viewer` **được xem dashboard** (`dashboard_daily_ops` cho phép: `app_is_staff_or_above() OR app_role()='employee_viewer'`, `database/002_functions.sql:332`). Thẻ "Lương đã phát" cũ dùng `data.payroll_paid` từ RPC nên hiển thị đúng cho mọi role.
- Nếu chuyển sang query thẳng bảng ở client thì với `employee_viewer` query bị RLS chặn → thẻ hiện **0 (sai)** + 2 query lỗi trên dashboard → **vỡ tiêu chí "Không vỡ KPI khác"**.
- RPC là `security definer` → đọc được `shift_*` và `app_settings` cho mọi role xem dashboard → con số đúng cho tất cả. Đây cũng đúng lựa chọn **đầu tiên** spec gợi ý (tên ví dụ `payroll_total_all` lấy thẳng từ spec).

**Hệ quả:** Hook chỉ cần payload dashboard (đã fetch sẵn) + timer `now`. Không thêm `useShiftsQuery`/`usePayrollQuery`/`useEmployeesQuery`/`useAppSettingsQuery` vào dashboard, không phát sinh network request mới, không lo RLS.

**Realtime cho `employee_viewer` — giới hạn có chủ đích (không phải regression):**
Supabase Postgres Changes tôn trọng RLS, nên `employee_viewer` (không qua `app_is_staff_or_above()`) **không nhận** event realtime của `shift_assignments`/`shift_payroll_records`. Đây là hành vi **nhất quán với toàn app**, không phải lỗi do feature này tạo ra:
- 4/6 bảng dashboard hiện đang subscribe đã loại `employee_viewer` bằng đúng RLS này: `sales_sync_runs`, `cash_close_reports`, `cash_counts`, `handover_tasks` (`database/003_rls.sql:153,177,170,277`). Vậy `employee_viewer` xưa nay đã không có realtime push cho các bảng staff-only.
- Quan trọng: **hiện tại CHƯA có** subscribe `shift_payroll_records` cho bất kỳ role nào → thẻ lương cũ KHÔNG cập nhật realtime cho cả owner (chỉ refetch theo `staleTime 30s`/focus). Feature này **thêm** push cho staff+ (cải thiện), và giữ nguyên đường eventual-consistency cho `employee_viewer` (RPC payload đúng số + tick 60s phần đang phát sinh đã tải + refetch theo `staleTime 30s` và `refetchOnWindowFocus`).
- → Không có role nào bị thụt lùi; staff+ được cải thiện. Dựng broadcast/pings-table riêng cho 1 role passive là YAGNI và lệch pattern app. **Quyết định: không thêm hạ tầng realtime mới**; document giới hạn + chỉnh từ ngữ acceptance criteria (push realtime nhắm staff+ — những người thực sự vào/ra ca).

**Khớp công thức ra ca:** Postgres `round(numeric)` và JS `Math.round` đều làm tròn nửa-lên với số **không âm** (miền của ta: minutes ≥ 0, rate ≥ 0). Công thức base `round((h*rate)/1000)*1000` khớp `check_out_employee` (`database/002_functions.sql:561`). Đây là số **tạm tính hiển thị**; số ra ca chính thức vẫn do DB ghi — sai khác float ở mốc 1.000đ là chấp nhận được.

---

## File Structure

| File | Loại | Trách nhiệm |
|---|---|---|
| `src/lib/labor-cost.ts` | Create | Hàm thuần `computeLiveLaborCost` + các type input. KHÔNG ghi DB, không dùng clock toàn cục. |
| `src/lib/__tests__/labor-cost.test.ts` | Create | Vitest cho hàm thuần (rounding, clamp, ngưỡng phụ cấp, nhiều ca). |
| `src/lib/types.ts` | Modify | `DashboardData` thêm 3 trường: `payroll_total_all`, `active_shifts`, `shift_bonus_config`. |
| `src/lib/data/dashboard.ts` | Modify | Default của `loadDashboard` thêm 3 trường mới (TS compile). |
| `src/hooks/use-live-labor-cost.ts` | Create | Hook: timer 60s cập nhật `now` → `computeLiveLaborCost` từ payload dashboard. |
| `src/features/dashboard/dashboard-view.tsx` | Modify | Gọi hook, truyền `liveLaborCost` cho `KpiBar`; `EMPTY` thêm 3 trường. |
| `src/features/dashboard/kpi-bar.tsx` | Modify | Thay thẻ "Lương đã phát" → "Lương hôm nay (tạm tính)" + nhãn "tạm tính". |
| `src/hooks/use-realtime-invalidate.ts` | Modify | Subscribe `shift_assignments` + `shift_payroll_records` → invalidate dashboard/shifts/payroll. |
| `database/migrations/2026-06-24-realtime-labor-cost.sql` | Create | `create or replace dashboard_daily_ops` (3 trường mới) + bật publication realtime (idempotent). |
| `database/002_functions.sql` | Modify | Đồng bộ `dashboard_daily_ops` canonical với migration. |
| `database/README.md` | Modify | Bước 4: thêm 2 bảng vào danh sách publication. |

---

## Coverage Matrix (đối chiếu yêu cầu user/spec → task)

| # | Yêu cầu (user prompt + spec) | Task |
|---|---|---|
| R1 | Hàm thuần `computeLiveLaborCost({finalizedTotal, activeShifts, now, bonusConfig})`; minutes=max(0,floor((now−in)/60s)); base=round((h*rate)/1000)*1000; allowance theo ngưỡng; KHÔNG ghi DB | Task 1 |
| R2.1 | (1) Tổng `total_pay` ca đã chốt hôm nay — **mọi** payment_method (khác `payroll_cash_total`) | Task 2 (`payroll_total_all`), Task 3 (type) |
| R2.2 | (2) Danh sách ca đang mở (`checked_in`, `check_out_at null`, hôm nay) kèm `check_in_at` + `hourly_rate` | Task 2 (`active_shifts`), Task 3 (type) |
| R2.3 | (3) `shift_bonus_config` từ `app_settings` (tái dùng) | Task 2 (`shift_bonus_config` trong payload) |
| R2.4 | "Hôm nay" = `businessDate` của dashboard, KHÔNG `current_date` thô | Task 2 (RPC nhận `p_business_date`); Task 4/5 dùng `businessDate` |
| R3.1 | Hook `useLiveLaborCost` gom (1)(2)(3), timer 60s cập nhật `now`, dọn timer khi unmount | Task 4 |
| R3.2 | `KpiBar` chỉ hiển thị (label "Lương hôm nay (tạm tính)" + nhãn "tạm tính") | Task 5 |
| R4 | Subscribe `shift_assignments` + `shift_payroll_records` → invalidate dashboard/shift/payroll theo businessDate; đúng pattern hiện có | Task 6 |
| R5 | Vitest: 0 ca→finalized; 1 ca rounding 1.000đ; clamp ≥0 future; ngưỡng phụ cấp dưới/đạt; nhiều ca cộng dồn | Task 1 |
| C1 | Realtime cần bảng trong publication — kiểm tra, nếu chưa thì thêm migration bật | Task 2 (idempotent) + Task 7 (verify) |
| C2 | App dùng LOCAL Supabase; KHÔNG `npm run build` khi dev đang chạy | Task 7 (chỉ `test:run`/`tsc`, không build) |
| O1 | NGOÀI PHẠM VI: mobile prototype (mock) — không động | Không có task; mobile không dựng `DashboardData` (đã verify) |
| O2 | NGOÀI PHẠM VI: không per-employee, không đổi công thức/ghi lương ra ca | Toàn bộ chỉ đọc + hiển thị; `check_out_employee` không đổi |

---

## Task 1: Hàm thuần `computeLiveLaborCost` + Vitest (TDD)

**Files:**
- Create: `src/lib/labor-cost.ts`
- Test: `src/lib/__tests__/labor-cost.test.ts`

- [ ] **Step 1: Viết test thất bại**

Tạo `src/lib/__tests__/labor-cost.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeLiveLaborCost, type ShiftBonusConfig } from "../labor-cost";

const NOW = new Date("2026-06-24T15:00:00+07:00");
const BONUS: ShiftBonusConfig = { threshold_hours: 7, bonus_amount: 10_000 };

/** ISO timestamp `minutes` phút trước NOW (test độc lập timezone vì so bằng getTime()). */
function checkInMinutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

describe("computeLiveLaborCost", () => {
  it("không ca mở → trả đúng finalizedTotal", () => {
    expect(
      computeLiveLaborCost({ finalizedTotal: 250_000, activeShifts: [], now: NOW, bonusConfig: BONUS })
    ).toBe(250_000);
  });

  it("1 ca mở: base làm tròn 1.000đ, cộng finalized", () => {
    // 90 phút = 1,5h × 25.000 = 37.500 → round 38.000; dưới 7h ⇒ không phụ cấp
    const result = computeLiveLaborCost({
      finalizedTotal: 100_000,
      activeShifts: [{ check_in_at: checkInMinutesAgo(90), hourly_rate: 25_000 }],
      now: NOW,
      bonusConfig: BONUS,
    });
    expect(result).toBe(138_000);
  });

  it("clamp ≥ 0 phút khi check-in ở tương lai (không âm)", () => {
    const future = new Date(NOW.getTime() + 30 * 60_000).toISOString();
    const result = computeLiveLaborCost({
      finalizedTotal: 50_000,
      activeShifts: [{ check_in_at: future, hourly_rate: 30_000 }],
      now: NOW,
      bonusConfig: BONUS,
    });
    expect(result).toBe(50_000);
  });

  it("phụ cấp: dưới ngưỡng không cộng, đạt ngưỡng cộng bonus_amount", () => {
    // 6h59m = 419 phút × 20.000 = 139.666,7 → /1000 = 139,67 → round 140 → 140.000; chưa đạt 7h
    const below = computeLiveLaborCost({
      finalizedTotal: 0,
      activeShifts: [{ check_in_at: checkInMinutesAgo(6 * 60 + 59), hourly_rate: 20_000 }],
      now: NOW,
      bonusConfig: BONUS,
    });
    expect(below).toBe(140_000);

    // đúng 7h = 420 phút × 20.000 = 140.000; đạt ngưỡng ⇒ + 10.000
    const atThreshold = computeLiveLaborCost({
      finalizedTotal: 0,
      activeShifts: [{ check_in_at: checkInMinutesAgo(7 * 60), hourly_rate: 20_000 }],
      now: NOW,
      bonusConfig: BONUS,
    });
    expect(atThreshold).toBe(150_000);
  });

  it("nhiều ca mở: cộng dồn + finalized", () => {
    const result = computeLiveLaborCost({
      finalizedTotal: 100_000,
      activeShifts: [
        { check_in_at: checkInMinutesAgo(60), hourly_rate: 30_000 }, // 1h → 30.000
        { check_in_at: checkInMinutesAgo(90), hourly_rate: 25_000 }, // 1,5h → 38.000
      ],
      now: NOW,
      bonusConfig: BONUS,
    });
    expect(result).toBe(168_000); // 100.000 + 30.000 + 38.000
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `npm run test:run -- src/lib/__tests__/labor-cost.test.ts`
Expected: FAIL — `Failed to resolve import "../labor-cost"` (file chưa tồn tại).

- [ ] **Step 3: Viết implementation tối thiểu**

Tạo `src/lib/labor-cost.ts`:

```ts
/**
 * Phép tính chi phí lương "tạm tính" real-time cho KPI Dashboard.
 *
 * Thuần + tất định → test được không cần clock/DB. Khớp công thức ra ca
 * (database/002_functions.sql check_out_employee): base làm tròn 1.000đ gần
 * nhất, phụ cấp là khoản cố định khi ca đạt ngưỡng giờ. Số chỉ để HIỂN THỊ —
 * không ghi gì xuống DB.
 */

export interface ActiveShiftInput {
  /** ISO timestamp lúc vào ca. */
  check_in_at: string;
  /** Đơn giá giờ của nhân viên (VND). */
  hourly_rate: number;
}

export interface ShiftBonusConfig {
  /** Số giờ làm đạt/ vượt thì áp phụ cấp cố định. */
  threshold_hours: number;
  /** Phụ cấp cố định (VND) cộng khi đạt ngưỡng. */
  bonus_amount: number;
}

export interface LiveLaborCostInput {
  /** Σ total_pay các ca đã chốt hôm nay, MỌI payment_method (VND). */
  finalizedTotal: number;
  /** Ca đang mở hôm nay (đã vào, chưa ra). */
  activeShifts: ActiveShiftInput[];
  /** Thời điểm hiện tại — caller tick để số lớn dần. */
  now: Date;
  bonusConfig: ShiftBonusConfig;
}

/**
 * Lương đã chốt + phần đang phát sinh của mọi người còn trong ca.
 * Trả về số VND; không bao giờ ghi DB.
 */
export function computeLiveLaborCost({
  finalizedTotal,
  activeShifts,
  now,
  bonusConfig,
}: LiveLaborCostInput): number {
  const nowMs = now.getTime();
  let accrued = 0;

  for (const shift of activeShifts) {
    const checkInMs = new Date(shift.check_in_at).getTime();
    // clamp ≥ 0 để check-in tương lai không tạo accrual âm
    const minutes = Math.max(0, Math.floor((nowMs - checkInMs) / 60_000));
    const hours = minutes / 60;
    // làm tròn 1.000đ gần nhất — khớp RPC ra ca
    const base = Math.round((hours * shift.hourly_rate) / 1000) * 1000;
    const allowance = hours >= bonusConfig.threshold_hours ? bonusConfig.bonus_amount : 0;
    accrued += base + allowance;
  }

  return finalizedTotal + accrued;
}
```

- [ ] **Step 4: Chạy test để xác nhận PASS**

Run: `npm run test:run -- src/lib/__tests__/labor-cost.test.ts`
Expected: PASS — 5 test xanh.

- [ ] **Step 5: Commit**

```bash
git add src/lib/labor-cost.ts src/lib/__tests__/labor-cost.test.ts
git commit -m "feat(dashboard): computeLiveLaborCost pure fn + Vitest"
```

---

## Task 2: RPC `dashboard_daily_ops` thêm 3 trường + bật Realtime publication

**Files:**
- Create: `database/migrations/2026-06-24-realtime-labor-cost.sql`
- Modify: `database/002_functions.sql:312-360` (đồng bộ canonical)
- Modify: `database/README.md` (Bước 4 — danh sách publication)

> Ghi chú môi trường: lúc viết plan, container `supabase-db` (DB của Chill ERP) đang **stopped**; `supabase_db_erp-ice-factory-v2` là **project KHÁC** — KHÔNG apply nhầm vào đó. Khởi động bằng `docker start supabase-db` trước khi apply (Task 7).

- [ ] **Step 1: Tạo migration**

Tạo `database/migrations/2026-06-24-realtime-labor-cost.sql`:

```sql
-- 2026-06-24-realtime-labor-cost.sql
-- Feature: "Lương hôm nay (tạm tính)" trên Dashboard.
-- (1) dashboard_daily_ops trả thêm 3 trường để client tính chi phí lương real-time:
--       payroll_total_all  = Σ total_pay đã chốt hôm nay (MỌI payment_method;
--                            khác payroll_paid/payroll_cash_total chỉ tiền mặt).
--       active_shifts      = [{check_in_at, hourly_rate}] các ca đang mở hôm nay.
--       shift_bonus_config = config phụ cấp (đọc trong RPC security definer nên
--                            mọi role xem dashboard đều có — kể cả employee_viewer).
--     RPC security definer ⇒ employee_viewer (bị RLS chặn đọc thẳng shift_*) vẫn
--     thấy đúng số. KHÔNG query thẳng bảng shift_* ở client.
-- (2) Bật Supabase Realtime cho shift_assignments + shift_payroll_records để
--     vào/ra ca & sửa lương invalidate dashboard ngay. Idempotent (có guard).
--
-- Idempotent: create or replace (giữ signature + grant cũ ở 003_rls.sql).

create or replace function public.dashboard_daily_ops(p_business_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_sales numeric(14,2) := 0;
  v_cash numeric(14,2) := 0;
  v_non_cash numeric(14,2) := 0;
  v_opening numeric(14,2) := 0;
  v_expenses numeric(14,2) := 0;
  v_payroll numeric(14,2) := 0;
  v_payroll_all numeric(14,2) := 0;
  v_active integer := 0;
  v_active_shifts jsonb;
  v_bonus_config jsonb;
  v_latest_count jsonb;
  v_latest_sync jsonb;
  v_expense_list jsonb;
  v_sales_list jsonb;
begin
  if not public.app_is_staff_or_above() and public.app_role() <> 'employee_viewer' then
    raise exception 'Bạn chưa có quyền xem dashboard.';
  end if;

  select coalesce(sum(net_amount), 0) into v_sales from public.sales_orders where business_date = p_business_date;
  select coalesce(sum(sp.amount), 0) into v_cash from public.sales_orders so join public.sales_payments sp on sp.sales_order_id = so.id where so.business_date = p_business_date and sp.payment_method = 'cash';
  v_non_cash := greatest(0, v_sales - v_cash);
  select coalesce(sum(opening_total), 0) into v_opening from public.cash_day_openings where business_date = p_business_date;
  select coalesce(sum(amount), 0) into v_expenses from public.expenses where business_date = p_business_date and payment_method = 'cash';
  select coalesce(sum(total_pay), 0) into v_payroll from public.shift_payroll_records where business_date = p_business_date and payment_method = 'cash';
  select coalesce(sum(total_pay), 0) into v_payroll_all from public.shift_payroll_records where business_date = p_business_date;
  select count(*) into v_active from public.shift_assignments where business_date = p_business_date and status = 'checked_in';

  select coalesce(jsonb_agg(jsonb_build_object('check_in_at', sa.check_in_at, 'hourly_rate', coalesce(e.hourly_rate, 0)) order by sa.check_in_at), '[]'::jsonb)
  into v_active_shifts
  from public.shift_assignments sa
  join public.employees e on e.id = sa.employee_id
  where sa.business_date = p_business_date
    and sa.status = 'checked_in'
    and sa.check_out_at is null
    and sa.check_in_at is not null;

  select value into v_bonus_config from public.app_settings where key = 'shift_bonus_config';
  v_bonus_config := coalesce(v_bonus_config, '{"threshold_hours": 7, "bonus_amount": 10000}'::jsonb);

  select to_jsonb(cc) into v_latest_count from (select id, business_date, count_type, counted_at, total_physical, total_theory, difference, pos_total, pos_cash_total, pos_non_cash_total, opening_cash, bank_transfer_confirmed, reconciliation_total from public.cash_counts where business_date = p_business_date order by counted_at desc limit 1) cc;
  select to_jsonb(sr) into v_latest_sync from (select id, source, status, started_at, finished_at from public.sales_sync_runs where business_date_from <= p_business_date and business_date_to >= p_business_date order by finished_at desc nulls last limit 1) sr;

  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'business_date', e.business_date, 'description', e.description, 'quantity', e.quantity, 'unit', e.unit, 'unit_price', e.unit_price, 'amount', e.amount, 'note', e.note, 'created_at', e.created_at, 'category_id', e.category_id, 'category_name', c.name) order by e.created_at desc), '[]'::jsonb)
  into v_expense_list
  from public.expenses e left join public.expense_categories c on c.id = e.category_id
  where e.business_date = p_business_date;

  select coalesce(jsonb_agg(jsonb_build_object('id', so.id, 'invoice_code', so.invoice_code, 'order_code', so.table_or_order_code, 'sold_by_name', so.sold_by_name, 'payment_method', coalesce(sp.payment_method, 'mixed'), 'net_amount', so.net_amount, 'total_payment', so.total_payment, 'purchase_at', so.purchase_at) order by so.purchase_at desc), '[]'::jsonb)
  into v_sales_list
  from public.sales_orders so
  left join lateral (select payment_method from public.sales_payments sp where sp.sales_order_id = so.id order by amount desc limit 1) sp on true
  where so.business_date = p_business_date;

  return jsonb_build_object('business_date', p_business_date, 'total_sales', v_sales, 'cash_sales', v_cash, 'non_cash_sales', v_non_cash, 'opening_cash', v_opening, 'total_expenses', v_expenses, 'payroll_paid', v_payroll, 'payroll_total_all', v_payroll_all, 'active_staff', v_active, 'active_shifts', v_active_shifts, 'shift_bonus_config', v_bonus_config, 'latest_cash_count', v_latest_count, 'latest_sync', v_latest_sync, 'expenses', v_expense_list, 'sales_orders', v_sales_list);
end;
$$;

-- Realtime publication cho ca/lương (idempotent — chỉ add nếu chưa là member).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shift_assignments') then
    alter publication supabase_realtime add table public.shift_assignments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shift_payroll_records') then
    alter publication supabase_realtime add table public.shift_payroll_records;
  end if;
end $$;
```

- [ ] **Step 2: Đồng bộ canonical `database/002_functions.sql`**

Thay nguyên khối `create or replace function public.dashboard_daily_ops...$$;` hiện ở `database/002_functions.sql:312-360` bằng **đúng phần `create or replace function ... $$;`** ở Step 1 (chỉ phần function, KHÔNG kèm khối `do $$ ... publication`). Mục tiêu: fresh-setup (apply 001+002+003) cũng có 3 trường mới.

- [ ] **Step 3: Cập nhật `database/README.md` (Bước 4)**

Trong khối SQL ở `database/README.md:117-123`, thêm 2 dòng cuối:

```sql
alter publication supabase_realtime add table public.shift_assignments;
alter publication supabase_realtime add table public.shift_payroll_records;
```

- [ ] **Step 4: Commit (apply DB để ở Task 7 cùng lúc khởi động container)**

```bash
git add database/migrations/2026-06-24-realtime-labor-cost.sql database/002_functions.sql database/README.md
git commit -m "feat(db): dashboard_daily_ops live labor fields + realtime ca/luong"
```

---

## Task 3: `DashboardData` + default loader

**Files:**
- Modify: `src/lib/types.ts:41-54`
- Modify: `src/lib/data/dashboard.ts:10-21`

- [ ] **Step 1: Thêm 3 trường vào `DashboardData`**

Trong `src/lib/types.ts`, sửa block `DashboardData` (sau `payroll_paid` / quanh `active_staff`):

```ts
export type DashboardData = {
  business_date: string;
  total_sales: number;
  cash_sales: number;
  non_cash_sales?: number;
  opening_cash?: number;
  total_expenses: number;
  payroll_paid: number;
  /** Σ total_pay đã chốt hôm nay — MỌI payment_method (khác payroll_paid cash-only). */
  payroll_total_all: number;
  active_staff: number;
  /** Ca đang mở hôm nay (đã vào, chưa ra) — client tính chi phí lương real-time. */
  active_shifts: Array<{ check_in_at: string; hourly_rate: number }>;
  /** Config phụ cấp đọc kèm payload (security definer) để client tính ngưỡng. */
  shift_bonus_config: { threshold_hours: number; bonus_amount: number };
  latest_cash_count?: CashCount | null;
  latest_sync?: SalesSyncRun | null;
  expenses: Expense[];
  sales_orders: SalesOrder[];
};
```

- [ ] **Step 2: Thêm 3 trường vào default của `loadDashboard`**

Trong `src/lib/data/dashboard.ts`, sửa object default (đối số 2 của `unwrapJson`):

```ts
  return unwrapJson<DashboardData>(data, {
    business_date: businessDate,
    total_sales: 0,
    cash_sales: 0,
    non_cash_sales: 0,
    opening_cash: 0,
    total_expenses: 0,
    payroll_paid: 0,
    payroll_total_all: 0,
    active_staff: 0,
    active_shifts: [],
    shift_bonus_config: { threshold_hours: 7, bonus_amount: 10000 },
    expenses: [],
    sales_orders: []
  });
```

- [ ] **Step 3: Verify typecheck (sẽ còn 1 lỗi EMPTY — sửa ở Task 5)**

Run: `npx tsc --noEmit`
Expected: lỗi duy nhất còn lại liên quan `EMPTY` ở `dashboard-view.tsx` thiếu 3 field — sẽ vá ở Task 5 Step 1. (Nếu môi trường yêu cầu commit sạch typecheck, gộp Task 3+5 trước khi chạy `tsc`.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/data/dashboard.ts
git commit -m "feat(dashboard): DashboardData live labor fields + default"
```

---

## Task 4: Hook `useLiveLaborCost`

**Files:**
- Create: `src/hooks/use-live-labor-cost.ts`

- [ ] **Step 1: Tạo hook**

Tạo `src/hooks/use-live-labor-cost.ts`:

```ts
"use client";

import { useEffect, useMemo, useState } from "react";
import { computeLiveLaborCost } from "@/lib/labor-cost";
import type { DashboardData } from "@/lib/types";

/** Tick mỗi 60s là đủ — mỗi phút chỉ thêm ~rate/60; không cần tick từng giây. */
const TICK_MS = 60_000;

type LiveLaborInput = Pick<
  DashboardData,
  "payroll_total_all" | "active_shifts" | "shift_bonus_config"
>;

/**
 * Chi phí lương "tạm tính" hôm nay = đã chốt (mọi method) + đang phát sinh.
 * Gom (1)(2)(3) từ payload dashboard (đã fetch sẵn) và chạy timer 60s cập nhật
 * `now` để con số tự tăng khi còn người trong ca. Dọn timer khi unmount.
 */
export function useLiveLaborCost(data: LiveLaborInput): number {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  return useMemo(
    () =>
      computeLiveLaborCost({
        finalizedTotal: data.payroll_total_all,
        activeShifts: data.active_shifts,
        now,
        bonusConfig: data.shift_bonus_config,
      }),
    [data.payroll_total_all, data.active_shifts, data.shift_bonus_config, now]
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/use-live-labor-cost.ts
git commit -m "feat(dashboard): useLiveLaborCost hook (60s tick)"
```

---

## Task 5: Nối DashboardView + đổi thẻ KpiBar

**Files:**
- Modify: `src/features/dashboard/dashboard-view.tsx`
- Modify: `src/features/dashboard/kpi-bar.tsx`

- [ ] **Step 1: `EMPTY` thêm 3 field + gọi hook + truyền prop**

Trong `src/features/dashboard/dashboard-view.tsx`:

(a) Thêm import (gần các import hook khác, ví dụ sau dòng `import { useUpdateUserDashboardPreferences } ...`):

```ts
import { useLiveLaborCost } from "@/hooks/use-live-labor-cost";
```

(b) Sửa hằng `EMPTY` (thêm 3 field để khớp `DashboardData`):

```ts
const EMPTY: DashboardData = {
  business_date: "",
  total_sales: 0,
  cash_sales: 0,
  non_cash_sales: 0,
  opening_cash: 0,
  total_expenses: 0,
  payroll_paid: 0,
  payroll_total_all: 0,
  active_staff: 0,
  active_shifts: [],
  shift_bonus_config: { threshold_hours: 7, bonus_amount: 10000 },
  expenses: [],
  sales_orders: [],
};
```

(c) Quan trọng (Rules of Hooks): chuyển khai báo `data` lên **TRƯỚC** các guard `isLoading`/`isError`, rồi gọi hook. Xóa dòng `const data = ...` cũ (đang ở sau guard, hiện `dashboard-view.tsx:140`). Cụ thể, ngay trước `if (dashboardQuery.isLoading) {` (hiện ở dòng 122), chèn:

```ts
  const data = dashboardQuery.data ?? { ...EMPTY, business_date: businessDate };
  const liveLaborCost = useLiveLaborCost(data);
```

Và xóa dòng cũ:

```ts
  const data = dashboardQuery.data ?? { ...EMPTY, business_date: businessDate };
```

(còn lại `const handover = handoverQuery.data ?? null;` giữ nguyên vị trí sau guard.)

(d) Truyền prop cho `KpiBar`:

```tsx
      <KpiBar data={data} liveLaborCost={liveLaborCost} />
```

- [ ] **Step 2: Đổi thẻ trong `KpiBar`**

Thay toàn bộ `src/features/dashboard/kpi-bar.tsx` bằng:

```tsx
"use client";

import { StatCard } from "@/components/ui/stat-card";
import { CountUp } from "@/components/ui/count-up";
import { Reveal } from "@/components/ui/reveal";
import { formatVND } from "@/lib/format";
import type { DashboardData } from "@/lib/types";

interface KpiBarProps {
  data: DashboardData;
  /** Chi phí lương tạm tính hôm nay (đã chốt mọi method + đang phát sinh). */
  liveLaborCost: number;
}

/**
 * Top-of-dashboard KPI strip — 4 pastel StatCards.
 *
 * Mapping:
 *   pos     -> "Thu POS"                     = total_sales (cash + non-cash, qua POS)
 *   expense -> "Tổng chi"                    = total_expenses
 *   payroll -> "Lương hôm nay (tạm tính)"    = liveLaborCost (đã chốt mọi method + đang phát sinh)
 *   staff   -> "Đang trong ca"               = active_staff (integer)
 *
 * Note: quán bán 100% qua POS nên một thẻ "Thu POS" đủ thể hiện doanh thu.
 * Lương tạm tính do useLiveLaborCost tính (client tick 60s); KpiBar chỉ hiển thị.
 *
 * Color order: peach / mint / lilac / peach — alternates warm/cool.
 */
export function KpiBar({ data, liveLaborCost }: KpiBarProps) {
  return (
    <Reveal
      stagger
      className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-4"
    >
      <StatCard
        color="peach"
        title="Thu POS"
        subtitle="Tổng doanh thu"
        value={<CountUp value={data.total_sales} format={formatVND} />}
      />
      <StatCard
        color="mint"
        title="Tổng chi"
        subtitle="Hôm nay"
        value={<CountUp value={data.total_expenses} format={formatVND} />}
      />
      <StatCard
        color="lilac"
        title="Lương hôm nay (tạm tính)"
        subtitle="tạm tính"
        value={<CountUp value={liveLaborCost} format={formatVND} />}
      />
      <StatCard
        color="peach"
        title="Đang trong ca"
        subtitle="Nhân viên"
        value={<CountUp value={data.active_staff} format={(n) => `${n} người`} />}
      />
    </Reveal>
  );
}
```

- [ ] **Step 3: Verify typecheck sạch**

Run: `npx tsc --noEmit`
Expected: 0 lỗi.

- [ ] **Step 4: Commit**

```bash
git add src/features/dashboard/dashboard-view.tsx src/features/dashboard/kpi-bar.tsx
git commit -m "feat(dashboard): thay the Luong da phat bang Luong hom nay (tam tinh)"
```

---

## Task 6: Realtime subscribe `shift_assignments` + `shift_payroll_records`

**Files:**
- Modify: `src/hooks/use-realtime-invalidate.ts`

- [ ] **Step 1: Thêm 2 subscription**

Trong chuỗi `.on(...)` của `src/hooks/use-realtime-invalidate.ts` (sau handler `safe_transactions`, trước `.subscribe()`), chèn:

```ts
      .on("postgres_changes", { event: "*", schema: "public", table: "shift_assignments" }, (payload) => {
        const row = (payload.new ?? {}) as { business_date?: string };
        if (row.business_date && row.business_date !== businessDate) return;
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
        queryClient.invalidateQueries({ queryKey: queryKeys.shifts(businessDate) });
        queryClient.invalidateQueries({ queryKey: queryKeys.payroll(businessDate) });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "shift_payroll_records" }, (payload) => {
        const row = (payload.new ?? {}) as { business_date?: string };
        if (row.business_date && row.business_date !== businessDate) return;
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
        queryClient.invalidateQueries({ queryKey: queryKeys.shifts(businessDate) });
        queryClient.invalidateQueries({ queryKey: queryKeys.payroll(businessDate) });
      })
```

(Vào ca → `dashboard` refetch → `active_shifts` xuất hiện → số bắt đầu tăng. Ra ca → phần đó rời `active_shifts` sang `payroll_total_all`. Sửa lương → `payroll_total_all` cập nhật. `shifts`/`payroll` invalidate để các view ca/lương khác đồng bộ.)

> **Guard businessDate (Codex finding #4):** event là `*` (gồm insert/update theo spec) nhưng callback **bỏ qua** thay đổi của ngày khác (`row.business_date !== businessDate`) để khỏi refetch dashboard hôm nay vô ích. INSERT/UPDATE luôn có `payload.new.business_date`; DELETE (hiếm) không có → guard cho qua → vẫn invalidate (an toàn). Cách này tránh phụ thuộc REPLICA IDENTITY của filter phía server.

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: 0 lỗi (`queryKeys.shifts`/`payroll`/`dashboard` đều sẵn ở `keys.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-realtime-invalidate.ts
git commit -m "feat(realtime): subscribe shift_assignments + shift_payroll_records"
```

---

## Task 7: Apply DB local + Verification

**Files:** không sửa code; chạy lệnh + quan sát.

- [ ] **Step 1: Khởi động DB Chill (nếu đang stopped) & apply migration**

> Codex finding #2: KHÔNG dùng `< file` (redirection không chạy ở PowerShell — shell chính của dự án). Dùng `docker cp` + `psql -f` cho chạy được ở mọi shell.

```bash
docker start supabase-db
docker cp database/migrations/2026-06-24-realtime-labor-cost.sql supabase-db:/tmp/2026-06-24-realtime-labor-cost.sql
docker exec supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/2026-06-24-realtime-labor-cost.sql
```

Expected: không lỗi (idempotent — chạy lại lần 2 vẫn OK). Lưu ý môi trường (memory): apply vào container `supabase-db`, KHÔNG phải `supabase_db_erp-ice-factory-v2` (project khác).

- [ ] **Step 2: Verify publication có 2 bảng mới**

```bash
docker exec -i supabase-db psql -U postgres -d postgres -c "select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename in ('shift_assignments','shift_payroll_records') order by 1;"
```

Expected: 2 dòng `shift_assignments`, `shift_payroll_records`.

- [ ] **Step 3: Verify RPC + dữ liệu (KHÔNG gọi thẳng RPC qua psql)**

> Codex finding #3: gọi `public.dashboard_daily_ops(...)` qua psql không có `auth.uid()` → `app_role()` = anonymous → RPC raise `'Bạn chưa có quyền xem dashboard.'`. Vì vậy verify **định nghĩa hàm** (đã có 3 key mới) + **sanity-check số liệu thô** (psql là superuser, bypass RLS — không qua RPC). Verify chức năng end-to-end làm ở Step 6 (đăng nhập owner thật).

(a) Định nghĩa hàm chứa 3 key mới:

```bash
docker exec supabase-db psql -U postgres -d postgres -c "select (pg_get_functiondef('public.dashboard_daily_ops(date)'::regprocedure) like '%payroll_total_all%' and pg_get_functiondef('public.dashboard_daily_ops(date)'::regprocedure) like '%active_shifts%' and pg_get_functiondef('public.dashboard_daily_ops(date)'::regprocedure) like '%shift_bonus_config%') as has_new_fields;"
```

Expected: `has_new_fields = t`.

(b) Sanity-check số liệu thô cho 1 ngày làm việc thật (thay `'2026-06-24'`):

```bash
docker exec supabase-db psql -U postgres -d postgres -c "select (select coalesce(sum(total_pay),0) from public.shift_payroll_records where business_date='2026-06-24') as payroll_total_all, (select count(*) from public.shift_assignments where business_date='2026-06-24' and status='checked_in' and check_out_at is null) as open_shifts, (select value from public.app_settings where key='shift_bonus_config') as bonus_config;"
```

Expected: 3 cột — `payroll_total_all` (số ≥ 0, gồm mọi method), `open_shifts` (số ca đang mở), `bonus_config` (jsonb threshold/bonus). Đây là cùng phép tính RPC dùng, xác nhận query đúng.

- [ ] **Step 4: Vitest toàn bộ xanh**

Run: `npm run test:run`
Expected: PASS toàn bộ (gồm `labor-cost.test.ts` 5 test). KHÔNG chạy `npm run build` khi `next dev` (port 3009) đang chạy.

- [ ] **Step 5: Typecheck sạch**

Run: `npx tsc --noEmit`
Expected: 0 lỗi.

- [ ] **Step 6: Thủ công (dev server 3009, owner@chill.local)**

1. Mở Dashboard → thẻ thứ 3 hiển thị "Lương hôm nay (tạm tính)" + nhãn "tạm tính".
2. Vào ca 1 nhân viên (Shifts) → quay lại Dashboard: số = lương đã chốt + phần đang phát sinh; chờ ~1 phút thấy nhích lên.
3. Ra ca nhân viên đó → số giữ nguyên tổng (phần đang phát sinh chuyển sang đã chốt).
4. (Tuỳ chọn) Mở 2 tab → vào/ra ca ở tab A → tab B tự cập nhật (realtime invalidate).
5. Đăng nhập role `employee_viewer` (nếu có) → thẻ vẫn ra số đúng, không lỗi console.

---

## Acceptance Criteria (đối chiếu §6 spec)

- [ ] Thẻ "Lương đã phát" được thay bằng "Lương hôm nay (tạm tính)" = đã chốt (mọi method) + đang phát sinh. *(Task 2/5)*
- [ ] Con số tự tăng theo phút khi có người trong ca, không cần tải lại. *(Task 4 timer + Task 1 công thức)*
- [ ] Vào/ra ca/sửa lương phản ánh **ngay (push realtime)** cho role staff+ (owner/manager/staff_operator) nhờ subscribe `shift_assignments` + `shift_payroll_records`; `employee_viewer` nhận **eventual consistency** qua `staleTime 30s`/`refetchOnWindowFocus` (nhất quán pattern app — xem Quyết định thiết kế). *(Task 2 publication + Task 6 subscribe)*
- [ ] `computeLiveLaborCost` có Vitest xanh (rounding, clamp, ngưỡng phụ cấp, nhiều ca). *(Task 1)*
- [ ] Không vỡ KPI khác trên dashboard; **con số đúng cho MỌI role** xem dashboard (kể cả `employee_viewer`, vì payload đến từ RPC security definer). *(Quyết định thiết kế)*

---

## Self-Review (đã chạy)

**1. Spec coverage:** Mọi mục §1–§6 spec + 5 yêu cầu user prompt đều có task (xem Coverage Matrix). Không phát hiện gap.

**2. Placeholder scan:** Không có TBD/TODO/"handle edge cases"/test rỗng; mọi step có code/command + expected output cụ thể.

**3. Type consistency:** Tên thống nhất xuyên suốt — `computeLiveLaborCost`, `ActiveShiftInput`, `ShiftBonusConfig`, `LiveLaborCostInput`; payload key `payroll_total_all` / `active_shifts` / `shift_bonus_config` khớp giữa SQL (Task 2) ↔ `DashboardData` (Task 3) ↔ hook (Task 4). Prop `liveLaborCost` khớp giữa `dashboard-view` ↔ `kpi-bar` (Task 5). `queryKeys.dashboard/shifts/payroll` đã tồn tại (`keys.ts`).

**Rủi ro đã xử lý:** (a) RLS `employee_viewer` → dùng payload RPC thay vì query bảng; (b) Rules of Hooks → gọi `useLiveLaborCost` trước guard `isLoading/isError`; (c) thêm field required vào `DashboardData` → chỉ 3 literal cần vá (đã liệt kê), mobile mock không đụng; (d) publication add không idempotent → bọc guard `pg_publication_tables`.

---

## Codex review — findings & resolutions (2026-06-24)

Plan đã qua Codex review (đối chiếu spec §1–§6). 4 finding, đã xử lý hết:

| # | Severity (Codex) | Finding | Resolution |
|---|---|---|---|
| 1 | Blocker → **đánh giá lại: giới hạn có chủ đích** | `employee_viewer` không nhận realtime event của `shift_*` (Postgres Changes tôn trọng RLS) | Có bằng chứng đây là pattern sẵn có (4/6 bảng dashboard đang subscribe đã loại `employee_viewer`; thẻ lương hiện CHƯA có realtime cho cả owner). Không regression; staff+ được cải thiện. **Không thêm hạ tầng** (YAGNI); document ở "Quyết định thiết kế" + chỉnh acceptance criteria (push = staff+, `employee_viewer` = eventual consistency). |
| 2 | Major | Task 7 Step 1 dùng `< file` — không chạy ở PowerShell | Đổi sang `docker cp` + `psql -f` (mọi shell). |
| 3 | Major | Task 7 Step 3 gọi RPC qua psql → `app_role()` anonymous → RPC raise | Verify bằng `pg_get_functiondef` (chứa 3 key mới) + sanity-check số liệu thô (superuser bypass RLS); verify e2e ở Step 6 (owner đăng nhập). |
| 4 | Minor | Task 6 subscribe `*` không lọc `business_date` → refetch dư | Thêm guard trong callback: bỏ qua khi `payload.new.business_date !== businessDate` (an toàn với REPLICA IDENTITY). |

Spec coverage sau fix: §1 ✓ · §2 ✓ · §3 ✓ (3.4: push staff+, `employee_viewer` eventual — có chủ đích) · §4 ✓ (lệnh verify đã chạy được) · §5 ✓ · §6 ✓ (acceptance criteria đã nêu rõ phạm vi realtime theo role).
