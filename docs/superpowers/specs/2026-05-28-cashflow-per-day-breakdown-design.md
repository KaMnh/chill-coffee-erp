# Cashflow — Per-Day Expense Breakdown + Safe Deposit Line — Design Spec

**Date:** 2026-05-28
**Branch (to be created):** `feat/cashflow-breakdown`
**Base:** `main` (post-v4.1.13)
**Tag at end:** `v4.1.15` (sau khi v4.1.14 merge — list-search-sort)

---

## 0. TL;DR

Mở rộng trang **Dòng tiền** (`/cash-flow`):

1. **Thay** `TopCategoriesTable` (Top 5 cho cả kỳ) bằng `ExpenseBreakdownTable`
   mới — hiển thị TẤT CẢ hạng mục chi sorted by amount, với master-detail accordion
   (click hạng mục → expand inline thấy danh sách từng khoản chi).
2. **Liên kết chart ↔ breakdown**: click 1 bar trong chart Thu/Chi → filter
   breakdown xuống chỉ ngày đó. Có button "Tất cả" để quay về tổng cả kỳ.
3. **Thêm series "Nạp két"** vào chart Thu/Chi — render dạng **line overlay**
   (Thu/Chi giữ là bar, Nạp két là line) để nhấn mạnh đây là khoản transfer tiền
   mặt → sổ quỹ, không phải thu/chi thường.

RPC `cash_flow_overview` được extend trả thêm:
- `by_day[i].safe_deposit` (numeric per day)
- `expense_breakdown[]` (full list categories với detail expenses) thay cho
  `top_categories[]` (hoặc bổ sung — quyết định ở §3).

---

## 1. Goal

Owner/manager muốn biết:

1. **"Hôm nào nạp két được nhiều/ít?"** — nhìn line Nạp két trên chart.
2. **"Tiền chi nhiều nhất vào hạng mục gì?"** — bảng breakdown sorted by amount.
3. **"Hạng mục Nguyên liệu hôm 27/05 chi cụ thể những khoản gì?"** — click bar
   27/05 + click hạng mục Nguyên liệu → thấy ngay list từng khoản.

**Acceptance criteria:**

- Chart Thu/Chi có 3 series: Bar Thu (xanh), Bar Chi (đỏ), Line Nạp két (cam) với
  tròn marker. Legend show cả 3.
- Click 1 bar → `selectedDate` set theo ngày bar đó. Breakdown table cập nhật.
  Header breakdown đổi: "Hạng mục chi · ngày 27/05/2026 [Tất cả]" với pill "Tất cả"
  để clear filter.
- Mặc định khi vào trang: `selectedDate = null` → breakdown show tổng cả kỳ.
- Mỗi category row trong breakdown: tên + tổng amount + % của tổng chi. Click row
  → expand inline thấy list expenses (description, amount, occurred_at, note).
  Nhiều rows có thể mở cùng lúc.
- Empty state: kỳ chưa có expense → "Chưa có chi phí trong kỳ" giống hiện tại.
- Empty state per-day: chọn ngày không có expense → "Ngày 27/05 không có khoản chi".
- `npm run verify` pass (typecheck + vitest + pgTAP).

---

## 2. Non-Goals (deferred)

| Item | Reason |
|---|---|
| Edit / delete expense inline trong breakdown | Đã có trang Chi phí riêng. Defer. |
| Drill từ Line "Nạp két" (click → cash close report của ngày đó) | YAGNI v1 — informational only. v2 có thể link sang. |
| Export breakdown ra CSV/Excel | Module Reports đã có export. Defer. |
| Filter breakdown by category (search trong table) | Sẽ có khi PR1 merge; pattern áp được. Tạm defer khỏi PR2 để không dependency. |
| Sort breakdown table | Default sort by amount desc — đủ cho 95% use case. |
| Compare period (% change vs kỳ trước) cho mỗi category | YAGNI. |
| Payroll hạng mục | Đã exclude trong RPC (payroll riêng); giữ pattern này. |

---

## 3. Architecture

### 3.1 Module layout

```
src/features/cashflow/
  cash-flow-view.tsx              ← mod: + selectedDate state, pass to chart + breakdown
  cash-flow-chart.tsx             ← mod: add Line series, add onClick on bars
  expense-breakdown-table.tsx     ← NEW (replace top-categories-table.tsx)
  top-categories-table.tsx        ← DELETE
```

### 3.2 RPC `cash_flow_overview` — extend signature

```sql
-- migration: database/migrations/2026-05-28-a-cashflow-breakdown.sql
create or replace function public.cash_flow_overview(
  p_start date,
  p_end date,
  p_compare_start date default null,
  p_compare_end date default null
) returns jsonb
language plpgsql
security definer
...
```

Thay đổi output JSONB:

```jsonc
{
  "in": ...,
  "out": ...,
  "net": ...,
  "by_day": [
    {
      "date": "YYYY-MM-DD",
      "in": ...,
      "out": ...,
      "safe_deposit": ...    // NEW — sum cash_close_reports.safe_deposit_amount where business_date = day AND status != 'voided'
    }
  ],
  "expense_breakdown": [    // NEW — replace top_categories
    {
      "category_id": "uuid|null",
      "category_name": "...",
      "amount": ...,
      "pct": 0.0..1.0,        // % of total out (incl payroll như cũ)
      "expenses": [
        {
          "id": "uuid",
          "business_date": "YYYY-MM-DD",
          "description": "...",
          "amount": ...,
          "occurred_at": "YYYY-MM-DDTHH:MM:SSZ",
          "note": "..."|null
        }
        // ... ALL expenses in period for that category, ordered by occurred_at desc
      ]
    }
  ],
  // top_categories REMOVED
  "prev_in": ..., "prev_out": ..., "prev_net": ...
}
```

**`safe_deposit` per day** — query:
```sql
select business_date, coalesce(sum(safe_deposit_amount),0) as safe_deposit
from public.cash_close_reports
where business_date between p_start and p_end
  and status <> 'voided'
group by business_date
```
Join vào by_day như cách `outs` đang join trong RPC hiện tại.

**`expense_breakdown`** — query:
```sql
select coalesce(ec.name,'(chưa phân loại)') as category_name,
       ec.id as category_id,
       sum(e.amount) as amount,
       jsonb_agg(
         jsonb_build_object(
           'id', e.id,
           'business_date', e.business_date,
           'description', e.description,
           'amount', e.amount,
           'occurred_at', e.occurred_at,
           'note', e.note
         ) order by e.occurred_at desc
       ) as expenses
from public.expenses e
left join public.expense_categories ec on ec.id = e.category_id
where e.business_date between p_start and p_end
group by ec.id, ec.name
order by sum(e.amount) desc;
```

Frontend filter theo `selectedDate`:
- Nếu `selectedDate === null` → show full breakdown từ RPC.
- Nếu set → filter `expenses` mỗi category xuống matching `business_date`, recompute
  category amount + pct dựa trên total expenses ngày đó (client-side). Category nào
  không có expense ngày đó → ẩn.

Trade-off: client-side filter giảm round-trip RPC mỗi lần click bar; data size
chấp nhận được (period max 31 ngày × ~50 expenses = ~1500 rows JSONB).

### 3.3 Frontend changes

**`cash-flow-view.tsx`**:
```tsx
const [selectedDate, setSelectedDate] = useState<string | null>(null);

// pass to chart + breakdown
<CashFlowChart byDay={...} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
<ExpenseBreakdownTable
  rows={query.data?.expense_breakdown ?? []}
  selectedDate={selectedDate}
  onClearDate={() => setSelectedDate(null)}
/>
```

**`cash-flow-chart.tsx`** changes:
- Import `Line, ComposedChart` from recharts (đổi từ `BarChart` → `ComposedChart`
  để mix bar+line).
- Map `data` thêm `safe_deposit: d.safe_deposit ?? 0`.
- Render `<Line dataKey="safe_deposit" stroke="var(--color-warning)" strokeWidth={2.5} dot />`.
- Legend formatter: thêm case `"safe_deposit"` → "Nạp két".
- Tooltip: thêm safe_deposit row.
- `<Bar onClick={(data) => onSelectDate?.(data.date)} cursor="pointer" />` cho cả 2 bars.
  Lấy date từ original `byDay[i].date`, không phải `date_label` (xx/yy).
- Highlight bar khi `selectedDate` match → opacity 1, các bar khác opacity 0.5.

**`expense-breakdown-table.tsx`** (new component):
```tsx
interface Props {
  rows: ExpenseBreakdownRow[];
  selectedDate: string | null;
  onClearDate(): void;
}

export function ExpenseBreakdownTable({ rows, selectedDate, onClearDate }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Filter rows theo selectedDate (client-side):
  const filteredRows = useMemo(() => {
    if (!selectedDate) return rows;
    return rows
      .map(r => ({
        ...r,
        expenses: r.expenses.filter(e => e.business_date === selectedDate),
      }))
      .filter(r => r.expenses.length > 0)
      .map(r => ({
        ...r,
        amount: r.expenses.reduce((s, e) => s + e.amount, 0),
      }));
  }, [rows, selectedDate]);

  const total = filteredRows.reduce((s, r) => s + r.amount, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Hạng mục chi {selectedDate && `· ${formatDate(selectedDate)}`}
        </CardTitle>
        {selectedDate && (
          <Button size="sm" variant="ghost" onClick={onClearDate}>
            Tất cả ✕
          </Button>
        )}
      </CardHeader>
      <CardBody>
        {filteredRows.length === 0 ? (
          <EmptyState ... />
        ) : (
          <table>
            {filteredRows.map(row => (
              <Fragment key={row.category_name}>
                <tr onClick={() => toggleExpanded(row.category_name)}>
                  <td>{expanded.has(row.category_name) ? '▼' : '▶'} {row.category_name}</td>
                  <td>{formatVND(row.amount)}</td>
                  <td>{(row.amount/total*100).toFixed(0)}%</td>
                </tr>
                {expanded.has(row.category_name) && (
                  <tr><td colSpan={3}>
                    <ul>{row.expenses.map(e => (
                      <li key={e.id}>
                        <span>{formatDate(e.business_date)}</span>
                        <span>{e.description}</span>
                        <span>{formatVND(e.amount)}</span>
                        {e.note && <small>· {e.note}</small>}
                      </li>
                    ))}</ul>
                  </td></tr>
                )}
              </Fragment>
            ))}
          </table>
        )}
      </CardBody>
    </Card>
  );
}
```

### 3.4 Types

`src/lib/types.ts` updates:

```ts
// existing
export interface CashFlowDayPoint {
  date: string;
  in: number;
  out: number;
  safe_deposit: number;   // NEW
}

// existing CashFlowTopCategory → REMOVE
// NEW:
export interface CashFlowExpenseRow {
  id: string;
  business_date: string;
  description: string;
  amount: number;
  occurred_at: string;
  note: string | null;
}
export interface CashFlowExpenseCategory {
  category_id: string | null;
  category_name: string;
  amount: number;
  pct: number;
  expenses: CashFlowExpenseRow[];
}
```

---

## 4. Validation rules

| Rule | Where |
|---|---|
| RPC vẫn check owner/manager | RPC line 1 (giữ nguyên) |
| selectedDate must be ISO date string nếu set | TypeScript signature |
| `safe_deposit` từ cash_close_reports `status <> 'voided'` | RPC query — voided reports không tính |
| `expense_breakdown` exclude payroll | Vẫn không include `shift_payroll_records` trong breakdown (chỉ expenses table) — giữ pattern hiện tại |
| pct denominator | `v_out` (total expenses + payroll). Note: payroll không trong breakdown nhưng vẫn trong denominator — nhất quán với hiện tại |

---

## 5. Verification

### Local (trước push)

1. **Apply migration**:
   ```bash
   cat database/migrations/2026-05-28-a-cashflow-breakdown.sql | docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
   ```

2. **RPC smoke**:
   ```sql
   SELECT public.cash_flow_overview('2026-05-01'::date, '2026-05-28'::date);
   ```
   Expect: JSON có `by_day[].safe_deposit`, `expense_breakdown[]` thay vì `top_categories[]`.

3. **Per-day filter accuracy**:
   - Chọn 1 ngày có expense → expense_breakdown sau filter client-side khớp với
     `select * from expenses where business_date = X`.

### App smoke

4. Login owner → /cash-flow.
5. Chart hiện 3 series: bar Thu, bar Chi, line cam Nạp két.
6. Tooltip hover hiện cả 3 giá trị.
7. Click 1 bar → header table đổi "Hạng mục chi · ngày XX/YY/2026", pill "Tất cả ✕"
   hiện. Breakdown filter xuống.
8. Click "Tất cả ✕" → quay về tổng kỳ.
9. Click 1 category row → expand inline, hiện list expenses.
10. Click row khác → cả 2 row mở cùng lúc.
11. Empty state: chọn ngày không có chi → "Ngày XX/YY không có khoản chi".

### CI

12. `npx tsc --noEmit` clean.
13. Vitest cũ pass (122/122).
14. pgTAP: extend `200_cash_flow_overview.sql` test cho:
    - `by_day[].safe_deposit` field tồn tại + đúng giá trị (insert cash_close_report
      và verify).
    - `expense_breakdown[]` structure đúng + voided reports loại trừ.
    - `top_categories[]` không còn (assert key not exists).

---

## 6. Execution order

1. Branch `feat/cashflow-breakdown` off `origin/main` (sau khi v4.1.14 merge).
2. SQL: migration `2026-05-28-a-cashflow-breakdown.sql` + patch `database/002_functions.sql`.
3. Apply migration local + RPC smoke (3 cases trên).
4. Update types in `src/lib/types.ts`.
5. New `expense-breakdown-table.tsx`, delete `top-categories-table.tsx`.
6. Modify `cash-flow-chart.tsx` (ComposedChart + Line + onClick).
7. Modify `cash-flow-view.tsx` (selectedDate state, pass props).
8. Local: tsc + vitest + manual preview smoke (4-11 trên).
9. Update pgTAP test `200_cash_flow_overview.sql`.
10. Commit + push + PR.
11. CI green → merge → tag `v4.1.15` → release.

---

## 7. Open assumptions / risks

- **`top_categories` REMOVE hay KEEP**: Spec đề xuất REMOVE (replace fully) vì
  `expense_breakdown` superset. Nếu user muốn giữ Top 5 mini-view → add lại với
  view-only display.
- **Performance JSONB size**: 31 ngày × 50 expense × 6 fields ≈ ~30KB JSONB. OK.
- **Voided reports excluded từ safe_deposit**: hợp lý — nếu báo cáo bị void, tiền
  đã rollback khỏi sổ quỹ rồi nên không nên show trên chart.
- **Payroll không trong breakdown**: giữ pattern hiện tại (chỉ expense, không
  payroll). Pct denominator vẫn là total OUT (expense + payroll).
- **Click bar UX trên mobile**: recharts onClick hoạt động trên touch. Nếu bar
  quá nhỏ (40+ ngày) → tap target nhỏ. Acceptable cho v1, fix nếu user phàn nàn.
- **Karpathy surgical**: 1 migration + 1 RPC change + 1 chart mod + 1 component
  replace + 1 view state. Không refactor utilities khác. Không động vào module
  cash (chốt két) hay safe.
- **i18n**: tiếng Việt, consistent.
