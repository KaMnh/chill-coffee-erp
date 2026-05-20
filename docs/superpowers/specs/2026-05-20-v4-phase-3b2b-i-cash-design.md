# Phase 3B.2b.i — Cash Write Module Design Spec

> **Status:** Approved 2026-05-20 (brainstorm)
> **Master plan:** `C:\Users\RAZER 15\.claude\plans\c-c-c-file-handoff-shimmering-kahan.md` §5 Phase 3B (split: 3B.1 expenses ✓, 3B.2a shifts ✓, **3B.2b.i cash UI NOW**, 3B.2b.ii tests+gate after)
> **Implements:** CashView — opening cash + denomination grid + reconciliation + close-cash + history + edit/void admin modals + 6 mutation hooks + cash-math.ts pure helpers

---

## 1. Mục tiêu

Thay placeholder `view === "cash"` bằng **CashView** đầy đủ chức năng — module ghi tiền rủi ro cao nhất trong v4:
- Mở két đầu ngày (opening cash với mệnh giá grid + safe withdrawal owner only)
- Đếm tiền theo mệnh giá (9 mệnh giá VND, stepper + quick-add + keyboard nav)
- Đối soát POS vs theory vs physical với công thức tường minh
- 2 thao tác cash count: "Kiểm két nhanh" (spot_audit) vs "Chốt két" (shift_close — tạo report + auto safe_deposit)
- Manual POS override khi KiotViet sync gãy
- Để lại cho ngày mai (leave_for_next_day) — phần dư không nạp sổ quỹ
- Lịch sử kiểm két với expand/collapse + admin edit/void
- 4 admin modal: edit cash count, edit cash close report, void report, leave denomination popup

Sau Phase 3B.2b.i, owner/manager/staff_operator login → click "Chốt két" → đủ flow vận hành cash daily (open → audit → close → admin edit/void nếu cần). v3 business logic giữ nguyên 100%, không lệch số.

---

## 2. Quyết định đã chốt (brainstorming 2026-05-20)

| Vấn đề | Lựa chọn |
|---|---|
| **Scope split (master plan 3B.2)** | Master plan = cash + shifts + tests. Anh đã chốt: 3B.1 (expenses ✓), 3B.2a (shifts ✓), **3B.2b.i (cash UI) NOW**, 3B.2b.ii (tests + gate) sau. Cash UI ship được + smoke test manual trước; test infra + verification gate là phase đóng riêng. |
| **Cash decomposition** | **Strict split + extract cash-math.ts (Đề xuất)**. v3 cash-panel.tsx 408 dòng → tách thành CashView (container) + DenominationGrid (reusable, dùng 4 chỗ) + ReconciliationSummary (display). + 4 modal port + 1 nested popup + denominations.ts + cash-math.ts pure helpers. ~12 file. Mỗi file 1 trách nhiệm. |
| **Form pattern** | Giữ `useState` + inline validation (proven trong 3A/3B.1/3B.2a). Denomination grid dùng `Record<string, number>` thay vì 9 hook riêng. |
| **Modal pattern** | Phase 2 `<Modal>` compound + nested Modal cho confirm-void (proven 3B.1) + nested popup cho leave-denomination (mới — nested inside EditCashCloseModal, validates double-portal). |
| **Optimistic updates** | Không. Mutation success → invalidate dashboard + cashCounts + cashOpening tuỳ mutation. Server-driven refetch. |
| **Cash math extraction** | **Extract pure helpers** vào `src/features/cash/cash-math.ts` — `computeTheoryCash`, `computeReconcileDiff`, `computeDenominationTotal`, `computeLeaveValidation`, `computeGreedyLeaveBreakdown`. Pure functions, no React, no Supabase, **testable độc lập ở 3B.2b.ii Vitest setup**. |
| **Test framework** | Defer Vitest/pgTAP đến 3B.2b.ii. Smoke + build verify cho 3B.2b.i. |

---

## 3. Phạm vi (Scope)

### Trong phạm vi
- **CashView**: container layout 2-col + 1 row history. Mounts queries + composes children + owns modal state.
- **OpeningCashModal**: opening day form với DenominationGrid + carried_from_previous_day toggle + safe_withdrawal_amount (owner only) + previous-day-leave hint. Read-only mode khi đã có opening và user không phải owner.
- **DenominationGrid (reusable component)**: 9 mệnh giá rows với stepper + quick-add chips [+1, +5, +10, +20] + keyboard nav (ArrowUp/Down/Left/Right) + total per row. Used trong CashView + OpeningCashModal + EditCashCountModal + LeaveDenominationPopup.
- **ReconciliationSummary**: display POS/opening/physical/bank-transfer/expense/payroll/theory/difference với công thức tường minh + manual POS override toggle (3 inputs khi enable).
- **CashView main panel**: combines DenominationGrid (left) + ReconciliationSummary (right) + bank-transfer + note + leave-for-next-day field + 2 submit buttons.
- **CashHistorySection**: list of today's cash_counts với expand/collapse + status badges + admin action buttons (Sửa count / Sửa report / Hủy report).
- **EditCashCountModal**: edit denominations + bank_transfer + note (chưa final). Owner/manager only.
- **EditCashCloseModal**: edit final report — note + leave_for_next_day only. Nested LeaveDenominationPopup.
- **LeaveDenominationPopup**: nested inside EditCashCloseModal, denomination grid for leave breakdown validation.
- **VoidCashCloseModal**: void final report với reason ≥5 chars + show safe-deposit reverse amount.
- **`useCashMutations` hook** (6 mutations):
  - `useSaveCashCount(supabase, businessDate)` — create cash_count (spot_audit or shift_close)
  - `useSaveCashDayOpening(supabase, businessDate)` — create/update opening
  - `useFinalizeCashClose(supabase, businessDate)` — finalize report after shift_close cash_count
  - `useUpdateCashCount(supabase, businessDate)` — edit existing cash_count (admin)
  - `useEditCashCloseReport(supabase, businessDate)` — edit final report note/leave (admin)
  - `useVoidCashCloseReport(supabase, businessDate)` — void final report (admin)
- Mount `CashView` vào `src/app/page.tsx` cho `view === "cash"`.

### NGOÀI phạm vi (defer)
- **Test framework setup** (Vitest + pgTAP + retro tests for shifts) → 3B.2b.ii
- **Verification gate** (mô phỏng trọn 1 ngày trên mirror) → 3B.2b.ii
- **Cash count vs report sync edge cases** — `update_cash_count` RPC handles snapshot sync; UI doesn't expose
- **Safe ledger** view (sổ quỹ) → Phase 3C (owner-only module)
- **Settings** (KiotViet config, account CRUD) → Phase 3C
- **Bulk cash count import / export** — YAGNI
- **Multi-currency** — YAGNI (VND only, 9 denominations fixed)
- **Receipt photo upload** — out of scope (safe lý do)
- **CheckOutModal `validatePayrollEdit` call** — opus reviewer note từ 3B.2a; not cash-related, defer 3B.2b.ii cleanup nếu rảnh

---

## 4. Kiến trúc

### 4.1 Tổng quan

```
src/app/page.tsx (Phase 3A, modify dispatcher only)
  └ {view === "cash" && <CashView businessDate={...} role={...} />}

src/features/cash/
  denominations.ts            ← port v3: DENOMINATIONS const + handleDenominationKeyDown + normalizeCount
  cash-math.ts                ← NEW pure helpers, testable in 3B.2b.ii
  denomination-grid.tsx       ← reusable component (4 consumers)
  reconciliation-summary.tsx  ← display only
  cash-view.tsx               ← container
    ├ useDashboardQuery(supabase, businessDate)           ← Phase 1
    ├ useCashOpeningQuery(supabase, businessDate)         ← Phase 1
    ├ useCashCountsQuery(supabase, businessDate)          ← Phase 1
    ├ useCashMutations (6 hooks from T1)
    ├ Local state: counts (Record<string,number>), bankTransfer, note, leave, manualPos*, isOpeningOpen, editingReportId, voidingReportId, editingCount
    └ render:
       ├ <DenominationGrid value={counts} onChange={setCounts} ... />
       ├ <ReconciliationSummary posTotal posCash openingCash physical bankTransferConfirmed expenseCash payrollCash />
       ├ bank-transfer + note + leave fields + 2 submit buttons
       ├ <CashHistorySection counts={cashCountsQuery.data} canManage onEditReport onVoidReport onEditCount />
       └ Modals (controlled by parent state):
          <OpeningCashModal open opening role businessDate onOpenChange />
          <EditCashCountModal open count onOpenChange />
          <EditCashCloseModal open reportId onOpenChange />   ← mounts LeaveDenominationPopup internally
          <VoidCashCloseModal open reportId onOpenChange />

src/hooks/mutations/
  use-cash-mutations.ts  (6 hooks co-located)
```

### 4.2 File structure (created/modified in 3B.2b.i)

```
src/
  app/
    page.tsx                                       [MODIFY — swap cash EmptyState for CashView]
  features/
    cash/
      denominations.ts                             [NEW — port v3 verbatim]
      cash-math.ts                                 [NEW — pure helpers extract]
      denomination-grid.tsx                        [NEW — reusable]
      reconciliation-summary.tsx                   [NEW]
      cash-view.tsx                                [NEW — container]
      cash-history-section.tsx                     [NEW — port v3]
      opening-cash-modal.tsx                       [NEW — port v3]
      edit-cash-count-modal.tsx                    [NEW — port v3]
      edit-cash-close-modal.tsx                    [NEW — port v3 + nested popup]
      leave-denomination-popup.tsx                 [NEW — port v3, used by edit-cash-close]
      void-cash-close-modal.tsx                    [NEW — port v3]
  hooks/
    mutations/
      use-cash-mutations.ts                        [NEW — 6 hooks co-located]
```

**Untouched:** Phase 1 backend (`lib/data/cash.ts` + `reports.ts` — 6 RPCs ready). Phase 1 validation (`validateCashCount`, `validateDenominations`). Phase 2 components. Phase 3A modules. Phase 3B.1 + 3B.2a modules. The `<Textarea>` primitive from 3B.2a reused here.

### 4.3 Hooks contracts (mutations)

File: `src/hooks/mutations/use-cash-mutations.ts`. 6 hooks co-located.

```ts
// Input types
export interface SaveCashCountInput {
  business_date: string;
  count_type: "spot_audit" | "shift_close";
  counted_at: string;  // ISO timestamp (now())
  denominations_json: Record<string, number>;
  total_physical: number;
  bank_transfer_confirmed: number;
  note: string;
  // Manual POS override fields (optional — only set when isManualPos):
  pos_total?: number;
  pos_cash_total?: number;
  pos_non_cash_total?: number;
}

export interface FinalizeCashCloseInput {
  cash_count_id: string;
  leave_for_next_day: number;
}

export interface SaveCashDayOpeningInput {
  business_date: string;
  denominations_json: Record<string, number>;
  carried_from_previous_day?: boolean;
  safe_withdrawal_amount?: number;
}

export interface UpdateCashCountInput {
  id: string;
  denominations_json?: Record<string, number>;
  bank_transfer_confirmed?: number;
  note?: string | null;
}

export interface EditCashCloseReportInput {
  reportId: string;
  note?: string | null;
  leaveForNextDay?: number | null;
}

export interface VoidCashCloseReportInput {
  reportId: string;
  reason: string;
}

// Hooks
export function useSaveCashCount(supabase, businessDate);
export function useFinalizeCashClose(supabase, businessDate);
export function useSaveCashDayOpening(supabase, businessDate);
export function useUpdateCashCount(supabase, businessDate);
export function useEditCashCloseReport(supabase, businessDate);
export function useVoidCashCloseReport(supabase, businessDate);
```

Invalidation map:
| Mutation | Keys invalidated |
|---|---|
| useSaveCashCount | `cashCounts(businessDate)` + `dashboard(businessDate)` (latest_cash_count field) |
| useFinalizeCashClose | `cashCounts(businessDate)` + `dashboard(businessDate)` + `reports(businessDate)` + `safeBalance()` + `safeTransactions()` (auto safe_deposit) |
| useSaveCashDayOpening | `cashOpening(businessDate)` + `dashboard(businessDate)` (opening_cash) + `safeBalance()` (if safe_withdrawal_amount > 0) + `safeTransactions()` |
| useUpdateCashCount | `cashCounts(businessDate)` + `dashboard(businessDate)` |
| useEditCashCloseReport | `cashCounts(businessDate)` + `reports(businessDate)` + `safeBalance()` + `safeTransactions()` (leave change → adjustment) |
| useVoidCashCloseReport | `cashCounts(businessDate)` + `reports(businessDate)` + `safeBalance()` + `safeTransactions()` (reverse) |

### 4.4 Data flow

```
Opening day:
User clicks "Nhập tiền đầu ngày" (no opening yet)
   ↓ setIsOpeningModalOpen(true)
   ↓ OpeningCashModal renders (create mode)
   ↓ Pre-fetches previousDayLeave hint via loadPreviousDayLeave
   ↓ User fills DenominationGrid + (optional) safe_withdrawal_amount
   ↓ useSaveCashDayOpening.mutateAsync({...})
   ↓ Invalidates cashOpening + dashboard + (safe if withdrawal)

Spot audit (quick check):
User fills denomination grid + bank_transfer + note in CashView
   ↓ Click "Kiểm két nhanh"
   ↓ validateCashCount({...}) → ok
   ↓ useSaveCashCount.mutateAsync({ count_type: "spot_audit", ... })
   ↓ RPC saves cash_count + cash_drawer_events snapshot
   ↓ Invalidates cashCounts + dashboard
   ↓ Toast "Đã lưu kiểm két nhanh"
   ↓ Counts reset OR stay (UX decision: stay so next audit can use same numbers)

Shift close (with report):
User fills denomination grid + bank_transfer + note + leave + (optional) manual POS override
   ↓ Click "Chốt két & tạo báo cáo"
   ↓ validateCashCount → ok
   ↓ useSaveCashCount.mutateAsync({ count_type: "shift_close", ... }) → returns cash_count_id
   ↓ useFinalizeCashClose.mutateAsync({ cash_count_id, leave_for_next_day }) → returns safe_deposit
   ↓ RPC creates cash_close_report + auto safe_transactions insert
   ↓ Invalidates everything (cashCounts + dashboard + reports + safeBalance + safeTransactions)
   ↓ Toast "Đã chốt két và nạp <X> vào sổ quỹ" (if safe_deposit > 0)
   ↓ Reset all fields

Admin edit cash_count:
Click "Sửa" on a non-final cash_count row → setEditingCount(count)
   ↓ EditCashCountModal opens with denominations + bank_transfer + note pre-filled
   ↓ Reject if cash_count has report_status="final" (RPC will reject; UI can preemptively disable button)
   ↓ User edits → useUpdateCashCount.mutateAsync({...})
   ↓ RPC recomputes physical/theory/diff + re-snapshot cash_drawer_events
   ↓ Invalidates cashCounts + dashboard

Admin edit cash_close_report (final):
Click "Sửa báo cáo" on shift_close row with report_status="final" → setEditingReportId(id)
   ↓ EditCashCloseModal opens
   ↓ User can ONLY edit note + leave_for_next_day (other fields read-only snapshot)
   ↓ "Xem chi tiết mệnh giá để lại" button → opens LeaveDenominationPopup nested
   ↓ LeaveDenominationPopup: DenominationGrid pre-seeded with greedy breakdown for leave amount
   ↓ User confirms breakdown → close popup → leave amount updated
   ↓ Submit → useEditCashCloseReport.mutateAsync({reportId, note, leaveForNextDay})
   ↓ RPC: if leave changed → insert adjustment safe_transaction for diff
   ↓ Invalidates cashCounts + reports + safeBalance + safeTransactions

Admin void cash_close_report:
Click "Hủy" on a final report row → setVoidingReportId(id)
   ↓ VoidCashCloseModal opens
   ↓ User enters reason (≥5 chars)
   ↓ Modal shows preview of safe_deposit amount that will be reversed
   ↓ User confirms → useVoidCashCloseReport.mutateAsync({reportId, reason})
   ↓ RPC marks report voided + inserts adjustment safe_transaction (reverse deposit)
   ↓ Invalidates cashCounts + reports + safeBalance + safeTransactions
```

### 4.5 cash-math.ts pure helpers (testable in 3B.2b.ii)

```ts
// src/features/cash/cash-math.ts

import { DENOMINATIONS } from "./denominations";

/** Sum of (denomination × count) across all 9 VND denominations. */
export function computeDenominationTotal(counts: Record<string | number, number>): number {
  return DENOMINATIONS.reduce(
    (sum, denom) => sum + denom * (Number(counts[denom] ?? counts[String(denom)] ?? 0) || 0),
    0
  );
}

/**
 * Theory cash = expected cash in drawer at this point in time.
 * = opening + bank_transfer_confirmed + total_expenses + payroll_paid - opening (zero-out implicit; v3 inline formula is:
 *   reconciliation = physical - opening + bank_transfer + expenses + payroll
 *   diff = posTotal - reconciliation
 * So theory_cash here is the "reconciliation" inverse — return the formula explicitly).
 *
 * Note: this returns RECONCILIATION TOTAL (the value posTotal should equal),
 * not "theory" in accounting sense. Matches v3 reconciliationPreview verbatim.
 */
export function computeReconciliation(input: {
  physical: number;
  openingCash: number;
  bankTransferConfirmed: number;
  expenseCashTotal: number;
  payrollCashTotal: number;
}): number {
  return (
    input.physical -
    input.openingCash +
    input.bankTransferConfirmed +
    input.expenseCashTotal +
    input.payrollCashTotal
  );
}

/** Difference = POS total - reconciliation. Zero = perfect; non-zero = lệch két. */
export function computeReconcileDiff(posTotal: number, reconciliation: number): number {
  return posTotal - reconciliation;
}

/** Validate leave_for_next_day ≤ physical_cash. */
export function isLeaveAmountValid(leave: number, physical: number): boolean {
  return leave >= 0 && leave <= physical;
}

/**
 * Greedy denomination breakdown for a target amount.
 * Used by LeaveDenominationPopup to pre-seed the grid.
 *
 * Example: leave=237_000 → { 200000:1, 20000:1, 10000:1, 5000:1, 2000:1 }
 *
 * Returns null if amount cannot be expressed (shouldn't happen with VND denoms).
 */
export function computeGreedyLeaveBreakdown(amount: number): Record<string, number> {
  const result: Record<string, number> = {};
  let remaining = Math.max(0, Math.floor(amount));
  for (const denom of DENOMINATIONS) {
    if (remaining <= 0) break;
    const count = Math.floor(remaining / denom);
    if (count > 0) {
      result[String(denom)] = count;
      remaining -= denom * count;
    }
  }
  return result;
}
```

All 5 functions are pure (no React, no Supabase, no globals). Each is testable with simple Vitest assertions in 3B.2b.ii.

### 4.6 Component → Phase 2 mapping

| Element | Component |
|---|---|
| CashView outer | Tailwind `space-y-6` (denomination panel + reconciliation aside + history below) |
| Section card | Phase 2 `<Card>` + `<CardHeader>` + `<CardBody>` |
| Denomination row | Custom `<article>` with stepper buttons + numeric input + quick-add chips |
| Stepper +/- buttons | Phase 2 `<IconButton icon="minus" size={32} variant="ghost">` and `<IconButton icon="plus" size={32} variant="ghost">` |
| Denomination input | Phase 2 `<TextField>` (numeric mode, sized smaller) |
| Quick-add chip | Custom `<button>` (small pill, +1 / +5 / +10 / +20) |
| Reconciliation summary table | Custom `<dl>` with 2-col grid (label / value), formula card with bold differences |
| Manual POS toggle | Phase 2 `<Checkbox>` with helper text |
| Manual POS inputs (3 fields) | Phase 2 `<TextField>` × 3 (conditional render) |
| Bank transfer / leave fields | Phase 2 `<TextField>` |
| Note | Phase 2 `<Textarea>` (from 3B.2a) |
| Submit buttons (2) | Phase 2 `<Button variant="secondary">` (spot_audit) + `<Button variant="primary">` (shift_close) |
| Status badge | Phase 2 `<Badge variant="soft" semantic="success|warning|danger|neutral">` |
| Modal shell | Phase 2 `<Modal>` compound |
| Toast feedback | Phase 2 `useToast()` |
| Empty state | Phase 2 `<EmptyState>` |
| History row expand/collapse | Custom toggle with chevron Icon |
| Confirm-void button | Phase 2 `<Button variant="destructive">` |
| Formula explanation card | Custom `<div>` with mono font + bold differences |

### 4.7 Reconciliation formula (v3 verbatim — load-bearing)

Display in `ReconciliationSummary`:
```
POS Total - ((Tiền thực đếm - Tiền vào ca) + Chuyển khoản đã nhận + Chi phí cash + Lương đã phát) = Chênh lệch
```

In code:
```ts
const reconciliation = computeReconciliation({
  physical,
  openingCash,
  bankTransferConfirmed,
  expenseCashTotal: dashboard.total_expenses,
  payrollCashTotal: dashboard.payroll_paid,
});
const difference = computeReconcileDiff(posTotal, reconciliation);
```

**Zero diff = perfect close-cash**. Non-zero = lệch két (operator notes the reason).

### 4.8 Status badge mapping for cash_count rows

```ts
function cashCountBadge(count: CashCount) {
  if (count.count_type === "spot_audit") {
    return <Badge variant="soft" semantic="neutral">Kiểm két nhanh</Badge>;
  }
  // shift_close
  if (count.report_status === "voided") {
    return <Badge variant="soft" semantic="danger">Đã hủy</Badge>;
  }
  if (count.report_status === "final") {
    return <Badge variant="soft" semantic="success">Đã chốt</Badge>;
  }
  return <Badge variant="soft" semantic="warning">{count.report_status ?? "pending"}</Badge>;
}
```

### 4.9 Default values & UI niceties (preserve v3)

- **Bank transfer placeholder**: defaults to `formatNumber(posNonCash)` — suggests cashier matches POS non-cash.
- **Leave default**: 0 (nạp toàn bộ vào sổ quỹ).
- **Leave hint**: shows `Sổ quỹ sẽ nhận {formatVND(physical - leave)}`.
- **Opening modal previousDayLeave hint**: queries `loadPreviousDayLeave(supabase, businessDate)` on open — shows `"Hôm qua để lại X — đếm để verify"` if previous report exists.
- **Manual POS hint**: "Khi bật, các giá trị POS ở bảng đối soát phía trên sẽ dùng số bạn nhập tay thay vì dữ liệu sync."
- **Counts persistence after spot_audit**: stay (UX decision — operator may need to check denominations multiple times before close).
- **Counts reset after shift_close**: yes (force fresh count for next day).

---

## 5. Component specs

### 5.1 CashView

**Props:** `{ businessDate: string; role: UserRole }`

**Responsibilities:**
- Mount 4 queries: useDashboardQuery, useCashOpeningQuery, useCashCountsQuery, usePayrollQuery
- Use 6 mutations: useCashMutations
- Compute `canManage = role === "owner" || role === "manager"`
- Compute `canCreateOpening = canManage`
- Compute `canEditOpening = role === "owner"` (sổ quỹ owner only constraint propagates)
- Own state: counts (denomination map), bankTransfer, note, leaveForNextDay, manualPos*, modal flags
- Render header → main panel (Grid + Reconciliation) → buttons → history → modals

**Loading/error:** Spinner while dashboard/cashOpening loading; AlertBanner on shifts/cashCounts error.

### 5.2 DenominationGrid (reusable)

**Props:**
```ts
interface DenominationGridProps {
  value: Record<string, number>;
  onChange(next: Record<string, number>): void;
  readOnly?: boolean;
  totalLabel?: string;  // e.g. "Tổng đếm" or "Tổng tiền đầu ngày"
}
```

**Responsibilities:**
- Render 9 denominations descending (500k → 1k) per `DENOMINATIONS` const
- Each row: denom label + stepper (-/+) + numeric input + 4 quick-add chips + row total
- Keyboard nav via `handleDenominationKeyDown` from denominations.ts
- Total at bottom: `computeDenominationTotal(value)` formatted VND
- `readOnly`: disable inputs + stepper + quick-add chips (e.g. opening modal viewer mode)

**Used by:**
- CashView main panel (the cash being counted)
- OpeningCashModal (opening day counts)
- EditCashCountModal (admin edit cash_count)
- LeaveDenominationPopup (leave breakdown)

### 5.3 ReconciliationSummary

**Props:**
```ts
interface ReconciliationSummaryProps {
  posTotal: number;
  posCash: number;
  posNonCash: number;
  openingCash: number;
  physical: number;
  bankTransferConfirmed: number;
  expenseCashTotal: number;
  payrollCashTotal: number;
  isManualPos: boolean;
  manualPosTotal: string;
  manualPosCash: string;
  manualPosNonCash: string;
  onManualPosToggle(v: boolean): void;
  onManualPosTotalChange(v: string): void;
  onManualPosCashChange(v: string): void;
  onManualPosNonCashChange(v: string): void;
}
```

**Responsibilities:**
- Render 10-row summary table (POS Total, POS Cash, POS NonCash, Opening, Physical, Bank Transfer, Expense, Payroll, Reconciliation, Difference)
- Difference colored green if 0, red if non-zero
- Formula card with mono font + `posTotal - ((physical - opening) + bankTransfer + expense + payroll) = difference` rendered with actual numbers
- Manual POS override block: Checkbox + (when enabled) 3 TextFields + hint paragraph

### 5.4 CashHistorySection

**Props:**
```ts
interface CashHistorySectionProps {
  counts: ReadonlyArray<CashCount>;
  canManage: boolean;
  onEditReport(reportId: string): void;
  onVoidReport(reportId: string): void;
  onEditCount(count: CashCount): void;
}
```

**Responsibilities:**
- Card with title "Lịch sử kiểm két ngày"
- Empty state if no counts
- Per-row: `formatDateTime(counted_at)` + count_type badge + total_physical + difference (colored)
- Row click → expand to show denomination breakdown + POS snapshot + bank transfer + note
- Admin action buttons (when canManage):
  - `spot_audit` → "Sửa" button (opens EditCashCountModal)
  - `shift_close` with `report_status === "final"` → "Sửa báo cáo" + "Hủy" buttons
  - `shift_close` with `report_status === "voided"` → no buttons (terminal state)

### 5.5 OpeningCashModal

**Props:**
```ts
interface OpeningCashModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  opening: CashDayOpening | null;
  businessDate: string;
  canEdit: boolean;  // owner only
  canCreate: boolean;  // owner OR manager
}
```

**Internal state:** counts (denom map), carriedFromPreviousDay (toggle), safeWithdrawalAmount (string)

**Behavior:**
- Reset on open: pre-fill from `opening` if exists, else empty
- Fetch `loadPreviousDayLeave(supabase, businessDate)` on first open if no opening — show "Hôm qua để lại X" hint
- `safe_withdrawal_amount` field shown only if `canEdit` (owner)
- Submit: `useSaveCashDayOpening.mutateAsync({...})`
- Read-only mode: when `opening !== null && !canEdit` → DenominationGrid readOnly=true + no submit button + just "Đóng" button

### 5.6 EditCashCountModal

**Props:**
```ts
interface EditCashCountModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  count: CashCount | null;
}
```

**Internal state:** counts, bankTransfer, note

**Behavior:**
- Reset on open from count prop
- Disabled if `count.report_status === "final"` — show banner "Báo cáo này đã chốt, sửa cash_count cần hủy báo cáo trước." + no submit button
- Submit: `useUpdateCashCount.mutateAsync({ id, denominations_json: counts, bank_transfer_confirmed, note })`

### 5.7 EditCashCloseModal

**Props:**
```ts
interface EditCashCloseModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  reportId: string | null;
}
```

**Internal state:** note, leaveForNextDay, isLeavePopupOpen, leaveBreakdown (for popup)

**Behavior:**
- On open: fetch report via `loadCashCloseReport(supabase, reportId)` (one-shot query — not a TanStack query)
- Pre-fill note + leaveForNextDay from fetched report
- Show read-only snapshot of report numbers (note + leave are the only editable fields per v3)
- "Xem chi tiết mệnh giá để lại" button (admin tool) → opens LeaveDenominationPopup
- Submit: `useEditCashCloseReport.mutateAsync({ reportId, note, leaveForNextDay })`
- Toast success, close modal

### 5.8 LeaveDenominationPopup

**Props:**
```ts
interface LeaveDenominationPopupProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  totalLeave: number;       // target amount from parent
  physicalCash: number;     // max boundary
  initialBreakdown?: Record<string, number>;  // from previous save, or computeGreedyLeaveBreakdown(totalLeave)
  onConfirm(breakdown: Record<string, number>, total: number): void;
}
```

**Internal state:** counts (denomination breakdown)

**Behavior:**
- Reset on open: `initialBreakdown ?? computeGreedyLeaveBreakdown(totalLeave)`
- Real-time total via `computeDenominationTotal(counts)`
- Validation banner: `isLeaveAmountValid(total, physicalCash)` → false → "Vượt quá tiền thực đếm"
- Confirm button disabled if invalid
- On confirm: `onConfirm(counts, total)` + close modal — parent updates its leaveForNextDay state from the popup-computed total

### 5.9 VoidCashCloseModal

**Props:**
```ts
interface VoidCashCloseModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  reportId: string | null;
}
```

**Internal state:** reason

**Behavior:**
- On open: fetch report via `loadCashCloseReport(supabase, reportId)` (one-shot)
- Show preview: `"Sổ quỹ sẽ được hoàn lại <safe_deposit_amount>"`
- Validation: `reason.trim().length >= 5` → submit enabled
- Submit: `useVoidCashCloseReport.mutateAsync({ reportId, reason })`
- Toast success, close modal

---

## 6. Error handling

| Scenario | Behavior |
|---|---|
| `validateCashCount` fail | AlertBanner danger inline + toast danger; submit returns |
| `useSaveCashCount` error | Toast danger; counts state preserved (user can retry) |
| `useFinalizeCashClose` error AFTER `saveCashCount` success | Toast danger "Cash count saved but finalize failed"; need manual recovery |
| Edit cash_count on final report | UI disables submit + shows banner; RPC also rejects (defense-in-depth) |
| Void without reason / reason <5 chars | Submit disabled; AlertBanner "Lý do tối thiểu 5 ký tự" |
| Leave amount > physical | AlertBanner danger in popup; confirm disabled |
| Edit cash_close_report leave change | RPC auto-inserts adjustment safe_transaction; toast shows new safe balance |
| Realtime dashboard refresh during edit | Modal state preserved (user input not lost) |
| Multi-tab: another tab voids report while edit modal open | EditCashCloseModal: on refetch error, show banner + close. Same stale-row pattern as 3B.1. |
| Manual POS toggle but no values entered | posTotal/posCash/posNonCash = 0 → difference will show big negative; that's expected (data inconsistency surfaced) |

---

## 7. Vietnamese terminology (preserved verbatim)

| Tiếng Việt | Context |
|---|---|
| Mệnh giá | Denomination |
| Tiền đầu ngày | Opening cash |
| Tiền thực đếm | Physical cash counted |
| Chuyển khoản đã nhận | Bank transfer confirmed |
| Kiểm két nhanh | Spot audit (no report) |
| Chốt két & tạo báo cáo | Shift close (creates report) |
| Để lại cho ngày mai | Leave for next day |
| Sổ quỹ sẽ nhận | Safe will receive |
| Lý thuyết / Tổng đối soát | Reconciliation total |
| Chênh lệch | Difference |
| Nhập POS thủ công | Manual POS override |
| Kiểm két theo mệnh giá | Cash counting by denomination |
| Đếm tiền mặt | Cash counting (eyebrow) |
| Cộng nhanh / +1 / +5 / +10 / +20 | Quick-add chips |
| Sửa count | Edit cash_count (admin) |
| Sửa báo cáo | Edit cash_close_report (admin) |
| Hủy báo cáo | Void cash_close_report (admin) |
| Lý do hủy | Void reason (min 5 chars) |
| Đã chốt / Đã hủy / Kiểm két nhanh | Status badges |
| Hôm qua để lại | Previous day's leave (opening modal hint) |
| Nạp tiền đầu ngày từ sổ quỹ | Safe withdrawal for opening (owner only) |

---

## 8. Verification strategy

### 8.1 Build verify
`npm run build` must remain clean. `/` route First Load JS expected to grow ~40-50 kB (1 reusable component + 5 modal components + 1 history + main view + 6 mutations + cash-math). Target ~290-310 kB total (vs 252 kB at 3B.2a).

### 8.2 Drift assertion scripts (Phase 3A)
Both `tools/verify-role-gate.mjs` and `tools/verify-business-date.mjs` must continue passing.

### 8.3 Manual smoke (operator-driven, ~18 checks)
After implementation:
1. Login owner; click "Chốt két" tab.
2. Empty seed: no opening, empty grid, "Nhập tiền đầu ngày" button shown.
3. Click "Nhập tiền đầu ngày" → OpeningCashModal create mode → DenominationGrid + safe_withdrawal (owner sees it).
4. Fill grid 500k×1 + 100k×2 → total 700k → save → toast → modal closes → opening shows 700k.
5. Main grid: count 1M physical (500k×1 + 200k×2 + 100k×1 = 1M).
6. ReconciliationSummary updates live as counts change.
7. Click "Kiểm két nhanh" → spot_audit saves → history row appears with "Kiểm két nhanh" badge.
8. Click "Chốt két & tạo báo cáo" with leave=0 → finalize → toast shows safe_deposit amount → history row "Đã chốt" badge.
9. Test manual POS toggle → 3 fields appear; enter values; reconciliation updates.
10. Test invalidTime/invalidLeave edge cases.
11. Admin click "Sửa" on spot_audit row → EditCashCountModal → change bank_transfer → save → row updates.
12. Admin click "Sửa báo cáo" on final row → EditCashCloseModal → change leave from 0 to 50k → save → safe balance changes by 50k (verify in safe_transactions table or wait for safe view 3C).
13. Admin click "Hủy" on final row → VoidCashCloseModal → reason "Test void" → confirm → row badge becomes "Đã hủy" → safe deposit reversed.
14. Stale-row guard: open EditCashCloseModal, in another tab void the report, return → modal closes cleanly.
15. KeyDownNav: in DenominationGrid, ArrowUp/Down moves focus between denomination inputs, ArrowLeft/Right increments/decrements.
16. Quick-add chips: tap "+5" → input value increases by 5.
17. Staff_operator login: "Sửa" and "Hủy" buttons NOT visible; "Nhập tiền đầu ngày" NOT visible if opening doesn't exist (only owner/manager); opening view-only if exists.
18. TZ edge: change businessDate to yesterday → opening shows yesterday's, history shows yesterday's counts.

### 8.4 Test framework
**Deferred to Phase 3B.2b.ii.** No Vitest/pgTAP in 3B.2b.i. The `cash-math.ts` pure helpers are designed to be tested in that phase.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `useSaveCashCount` succeeds but `useFinalizeCashClose` fails — orphan cash_count without report | Atomic submit pattern: catch error after first await; toast clear about partial state; provide manual retry instructions. v3 has same risk; document in plan task error handling. |
| Denomination grid state divergence across 4 consumers | Single `<DenominationGrid>` component; same component, different `value` + `onChange` props. No copy-paste of grid logic. |
| Leave amount > physical at submit time | Both client (computeLeaveValidation) and server (RPC check) reject. Client preempts. |
| Float arithmetic on currency | All currency math uses integer VND (no decimals). DENOMINATIONS are integers. moneyFromInput returns integer. |
| Manual POS override forgotten / wrong values | Save button always works; reconciliation displays current numbers; operator sees difference clearly. Manual mode is opt-in checkbox. |
| Edit cash_count: report sync drift | Phase 1 `update_cash_count` RPC handles re-snapshot of cash_drawer_events. UI doesn't manage. |
| Leave denomination breakdown mismatch | Popup recomputes greedy on open; user can override. Total displayed real-time. Validation: ≤ physical. |
| Realtime invalidation interrupts in-progress edit | Modal state isolated from query data; closing modal explicitly resets. |
| Stale `editing*Id` after another tab voids | Apply same useEffect stale-guard pattern as 3B.1 ExpenseEditModal + 3B.2a PayrollHistoryCard. |

---

## 10. Definition of Done (Phase 3B.2b.i)

- [ ] `CashView` mounted; clicking "Chốt két" nav renders.
- [ ] Opening cash flow: create + (owner) edit works; previous-day leave hint shown.
- [ ] Spot audit: save works, history row appears.
- [ ] Shift close: save + finalize works, safe_deposit toasted, history row + report status updates.
- [ ] Manual POS override: toggle works, 3 fields editable, reconciliation respects override.
- [ ] Admin edit cash_count: works for non-final counts.
- [ ] Admin edit cash_close_report: note + leave editable, LeaveDenominationPopup works.
- [ ] Admin void cash_close_report: reason ≥5 required, safe_deposit reversed.
- [ ] DenominationGrid keyboard nav (arrow keys) works.
- [ ] DenominationGrid quick-add chips (+1, +5, +10, +20) work.
- [ ] Staff_operator can use main spot_audit/shift_close flow but cannot see admin Sửa/Hủy.
- [ ] cash-math.ts exports 5 pure functions, tested manually by inspection (Vitest tests follow in 3B.2b.ii).
- [ ] Phase 3A drift scripts (`verify-role-gate.mjs` + `verify-business-date.mjs`) pass.
- [ ] `npm run build` clean.
- [ ] Code review: spec compliance + code quality both pass.
- [ ] Branch `phase-3b2b-i-cash` merged về `main`; tag `v4-phase-3b2b-i`.

---

## 11. References

- **v3 source** (port-from):
  - `F:\Chill manager\v3\src\features\cash\denominations.ts` — 49 dòng
  - `F:\Chill manager\v3\src\features\cash\cash-panel.tsx` — 408 dòng (will be split)
  - `F:\Chill manager\v3\src\features\cash\opening-cash-modal.tsx` — 217 dòng
  - `F:\Chill manager\v3\src\features\cash\cash-history-section.tsx` — 244 dòng
  - `F:\Chill manager\v3\src\features\cash\edit-cash-count-modal.tsx` — 245 dòng
  - `F:\Chill manager\v3\src\features\cash\edit-cash-close-modal.tsx` — 213 dòng
  - `F:\Chill manager\v3\src\features\cash\leave-denomination-popup.tsx` — 148 dòng
  - `F:\Chill manager\v3\src\features\cash\void-cash-close-modal.tsx` — 155 dòng
- **Phase 1 (ported, frozen)**:
  - `src/lib/data/cash.ts` — saveCashCount, updateCashCount, loadCashCountsByDate, loadCashDayOpening, loadPreviousDayLeave, saveCashDayOpening
  - `src/lib/data/reports.ts` — loadCashCloseReport, finalizeCashCloseReport, editCashCloseReport, voidCashCloseReport
  - `src/lib/validation.ts` — validateCashCount, validateDenominations
  - `src/lib/format.ts` — formatVND, formatNumber, moneyFromInput, formatDateTime
  - `src/hooks/queries/use-cash-queries.ts` — useCashOpeningQuery, useCashCountsQuery
- **Phase 2:** Modal compound, TextField, Textarea (3B.2a), Checkbox, Button, IconButton, Badge, AlertBanner, EmptyState, Card, useToast, Icon
- **Phase 3A:** page.tsx dispatcher; useBusinessDate; useRoleGate
- **Phase 3B.1 patterns:** mutation hooks file structure
- **Phase 3B.2a patterns:** Modal compound + nested Modal (3B.1) + nested popup (NEW here)
- **Master plan:** `C:\Users\RAZER 15\.claude\plans\c-c-c-file-handoff-shimmering-kahan.md`
