# Phase 3C.1 — Safe Module (Owner-only Ledger UI) Design Spec

**Date:** 2026-05-21
**Branch:** `phase-3c1-safe` (off `main` @ `78e923e` = tag `v4-phase-3b2b-ii-b`)
**Tag at end:** `v4-phase-3c1`
**Predecessor:** Phase 3B.2b.ii.b (pgTAP + verify:phase gate)
**Sub-phase position:** 1 of 3 in Phase 3C (Safe → Settings → Handover)
**Successor in 3C:** Phase 3C.2 (Settings)

---

## 0. TL;DR

Build the owner-only UI for the `safe_transactions` ledger (sổ quỹ). All Phase 1 backend RPCs and the `src/lib/data/safe.ts` data layer are already plumbed and frozen. This phase adds:

1. **One new Phase 2 primitive**: `FileUploadField` (the first file-upload primitive in v4)
2. **6 new mutation hooks** in `src/hooks/mutations/use-safe-mutations.ts`
3. **3 new validators** in `src/lib/validation.ts`
4. **8 new files** under `src/features/safe/**`
5. **page.tsx dispatcher wire** for the existing `view === "safe"` route
6. **1 modified file** (`src/hooks/queries/keys.ts` — adds `safeAttachments` key)

Owner can: view safe balance, initial-setup (one-time), record withdrawals with category + receipt attachments, adjust balance for discrepancies (with confirmation), snapshot denomination counts, browse transaction history with date+type filters, and view+attach receipts to past transactions.

No new tests in this phase — Vitest helpers cover validators (will be added in Phase 6 when component test infra stands up); pgTAP already covers safe_* RLS (file `070_rls_safe_tables.sql`).

---

## 1. Goal

Deliver a working owner-only Safe module that matches v3 functionality, ports the modal patterns from Phase 3B (cash/expenses/shifts), and uses the existing data layer without modification.

**Acceptance criteria**:
- Owner login → "Sổ quỹ" sidebar item → SafeView renders
- All 4 write flows (Setup / Withdraw / Adjust / Count) functional
- Receipt upload/delete works end-to-end (Storage bucket → safe_attachments table)
- History list with date range + type filter + "load older" windowing
- Manager/staff cannot see the "Sổ quỹ" nav item (already gated by Phase 3A `NAV_ITEMS`)
- `npm run verify:phase` passes unchanged (75 Vitest + 50 pgTAP)

---

## 2. Non-Goals (deferred)

| Item | Deferred to | Reason |
|---|---|---|
| Vitest tests for new validators (`validateSafeWithdraw`, etc.) | Phase 6 | Existing pattern: validators get characterization tests in dedicated test infra phase. Phase 6 adds CI + coverage so test additions get a proper gate. |
| Component tests (RTL / Playwright) for SafeView | Phase 6 | Component test infra not yet in place. |
| pgTAP for safe RPCs (setup/withdraw/adjust/count) | Phase 6 | safe_* RLS already covered by 3B.2b.ii.b (`070_rls_safe_tables.sql`); RPC logic tests defer to gia cố phase. |
| Snapshot tests of attachment thumbnails | Phase 6 | Brittle, low value. |
| Cursor/offset pagination of safe_transactions | Phase 6 | RPC is frozen (`safe_list_transactions(p_from, p_to, p_type)` has no limit/offset). We use date-range windowing as the pagination mechanic. |
| Multi-file batch upload (drag-drop multiple files at once) | Phase 6+ | Single-file upload at a time is sufficient for the receipt workflow. |
| Image preview at full-screen (lightbox) | Phase 6+ | Thumbnail + signed URL click-to-open in new tab is sufficient for Phase 1 receipt UX. |
| Real-time sync of safe_balance across sessions (multi-owner concurrency) | Phase 6 | Single-owner deployment in target shops. |
| Audit log viewer for owner reviewing safe activity history | Phase 4 or later | Audit log infra exists (`audit_log` table) but no UI yet. Cross-cutting feature, not safe-specific. |

---

## 3. Architecture

### 3.1 Flow diagram

```
User (owner role) → page.tsx dispatcher (view === "safe")
                         │
                         ▼
                   <SafeView />          ← owner-only gate (defense-in-depth)
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
       Balance Card  History    Modal stack
        (4 buttons)  Section     (5 modals)
              │          │          │
              │          │          ├─ SetupSafeModal
              │          │          ├─ WithdrawSafeModal     ─┐
              │          │          ├─ AdjustSafeModal        │── all 3 compose
              │          │          ├─ CountSafeModal         │   SafeAttachmentUpload
              │          │          └─ SafeTransactionDetailModal ─┘
              │          │
              │          ▼
              │     load 90-day window via useSafeTransactionsQuery
              │     "Tải thêm 90 ngày trước" extends fromDate backward
              │
              ▼
        useSafeBalanceQuery (staleTime 30s)
```

### 3.2 Mutation invalidation map

```
Mutation hook              → Invalidates
─────────────────────────────────────────────────────────────
useSetupSafeInitial        → safeBalance, ["safe","transactions"]
useWithdrawSafeOther       → safeBalance, ["safe","transactions"]
useAdjustSafe              → safeBalance, ["safe","transactions"]
useCountSafe               → safeCounts (NO balance — count is snapshot)
useUploadSafeAttachment    → ["safe","attachments",txId], ["safe","transactions"] (attachment_count)
useDeleteSafeAttachment    → ["safe","attachments",txId], ["safe","transactions"]
```

### 3.3 Count → Adjust chain (key UX flow)

The CountSafeModal's RPC returns `{difference}`. If non-zero, the modal switches to a "review" view with an AlertBanner.warning showing the diff and two buttons:
- "Đóng" — dismiss, no change
- "Điều chỉnh ngay" — closes CountSafeModal, opens AdjustSafeModal with `newBalance` pre-filled to `total_physical`

The chain is implemented via `SafeView` parent state:
```ts
const [pendingAdjust, setPendingAdjust] = useState<{ newBalance: number } | null>(null);
```
When set, `<AdjustSafeModal initialNewBalance={pendingAdjust.newBalance} />` opens. Closing it clears `pendingAdjust`.

### 3.4 Inline + post-hoc attachment dual flow

- **Inline** (Withdraw/Adjust modals): After RPC creates the txn, the modal stays open and shows `SafeAttachmentUpload` with the newly-created `transactionId`. User attaches 0–5 files before manually closing.
- **Post-hoc** (TransactionDetailModal): Opens an existing txn, loads its attachments, allows upload (subject to 5-cap).

### 3.5 Windowed pagination

The frozen RPC `safe_list_transactions(p_from, p_to, p_type)` has no cursor/offset. The UI maps "pagination" to date-range windowing:
- Initial fetch: `fromDate = today - 90d`, `toDate = today`
- "Tải thêm 90 ngày trước" button: subtracts 90 more days from `fromDate`, re-queries
- React Query caches per `(fromDate, toDate, type)` key tuple
- Custom from/to via filter inputs overrides the windowing logic

This is NOT cursor pagination but is the only viable approach without modifying the frozen RPC.

---

## 4. Components

### 4.1 FileUploadField (NEW Phase 2 primitive)

`src/components/ui/file-upload-field.tsx` — minimal API matching the existing TextField/Textarea convention.

```ts
interface FileUploadFieldProps {
  label?: string;
  helper?: string;
  error?: string;
  accept: string;                  // e.g. "image/jpeg,image/png,image/heic,image/heif"
  disabled?: boolean;
  onSelect: (file: File) => void;
  selectedFileName?: string;       // controlled — parent owns
  onClear?: () => void;
}
```

**Renders**: label (top), hidden `<input type="file">`, visible "Chọn file" button + selected file name + clear icon button (when file is selected).

**Does NOT trigger upload** — parent owns the upload mutation. Single-file by design (multi-file = parent uses an array or list).

**Lines**: ~80.

### 4.2 SafeAttachmentUpload (NEW reusable feature component)

`src/features/safe/safe-attachment-upload.tsx` — composes `FileUploadField` + mutation hooks + thumbnail list. Used by 3 modals (Withdraw, Adjust, TransactionDetail).

```ts
interface SafeAttachmentUploadProps {
  transactionId: string | null;    // null = no txn yet (modal hides upload UI)
  attachments: SafeAttachment[];   // current list (loaded by parent)
  onAttachmentsChange: () => void; // callback to refetch list
  disabled?: boolean;
}
```

**Behavior matrix**:
| State | UI |
|---|---|
| `transactionId === null` | Placeholder text: "Lưu giao dịch trước, sau đó upload hóa đơn" |
| `transactionId` set, attachments.length < 5 | `<FileUploadField>` + "Upload" button → calls `useUploadSafeAttachment` → on success calls `onAttachmentsChange()` |
| `transactionId` set, attachments.length === 5 | Hides picker; shows "Đã đạt giới hạn 5 ảnh" |

**Each attachment row** shows: thumbnail (signed URL fetched lazily via `getSafeAttachmentSignedUrl(path, 3600s)`), file name, file size (kB/MB), delete button.

**Lines**: ~150.

### 4.3 Modal-by-modal

#### SetupSafeModal (~110 lines)
- **Form**: amount (TextField, inputMode="numeric") + note (Textarea, optional)
- **Validation**: `validateSafeSetup`
- **Visibility guard**: only shows if `safeBalance === 0 && txnCount === 0` (truly first-time). Balance card hides the Setup button once first txn exists.
- **No attachment upload** — initial setup is a single-amount declaration, no receipt needed.
- **On success**: toast + close. Balance + transactions invalidate → balance card refetches.

#### WithdrawSafeModal (~180 lines)
- **Form fields**: amount (TextField), category (Select: utilities/rent/inventory/maintenance/other), description (Textarea, optional)
- **Validation**: `validateSafeWithdraw(input, currentBalance)`
- **Flow**: Fill form → click "Rút" → RPC fires → on success, modal STAYS OPEN, replaces "Rút" button with "Đóng", shows `<SafeAttachmentUpload transactionId={result.id} attachments={[]} ...>`
- User can upload 0-5 receipts before closing
- Closing the modal calls `onOpenChange(false)`; React Query invalidates and the history list shows the new txn

#### AdjustSafeModal (~170 lines, TWO-STEP)
- **Step 1 (form)**: `newBalance` TextField (may be pre-filled from chain — `initialNewBalance` prop), `note` Textarea (≥5 chars required)
- **Validation**: `validateSafeAdjust(input, currentBalance)`
- **Step 1 footer**: "Hủy" + "Tiếp" buttons
- **Step 2 (confirm)**: AlertBanner.danger showing `currentBalance → newBalance (+/- delta)` + the note text. Two buttons: "Quay lại" (back to step 1) + "Xác nhận điều chỉnh" (fires RPC)
- **After RPC succeeds**: modal stays open, transitions to attachment-upload UI like Withdraw
- **Pattern reference**: inline confirmation from `expense-edit-modal.tsx:104-120`

#### CountSafeModal (~140 lines)
- **Form**: `<DenominationGrid value={counts} onChange={setCounts} />` (reused from cash module) + note Textarea (optional)
- **On submit**: calls `countSafe()` → returns `{id, total_physical, expected_balance, difference}`
- **Result view** (modal switches in-place):
  - `difference === 0` → AlertBanner.success "Khớp sổ quỹ" + close button
  - `difference !== 0` → AlertBanner.warning showing `Đếm thực: X | Dự kiến: Y | Lệch: ±Z` + 2 buttons "Đóng" + "Điều chỉnh ngay"
- **"Điều chỉnh ngay"**: closes CountSafeModal, opens AdjustSafeModal with `newBalance = total_physical` (via `pendingAdjust` state in parent)

#### SafeTransactionDetailModal (~130 lines)
- **View-only header**: `occurred_at`, `transaction_type` (badge), `amount` (signed VND), `category`, `description`, `created_by`
- **Composes `<SafeAttachmentUpload>`** with the txn's `id` and loaded attachments
- **No edit controls** — transactions are immutable. Corrections happen via Adjust (new txn).
- **Close button only**

### 4.4 SafeView container (~250 lines)

`src/features/safe/safe-view.tsx`

**Props**: `{ businessDate: string; role: UserRole }` (matches CashView signature)

**Defense-in-depth gate**: 
```tsx
if (role !== "owner") {
  return <EmptyState icon="lock" title="Module owner only" subtitle="..." />;
}
```

**Queries**:
- `useSafeBalanceQuery(supabase, enabled)`
- `useSafeTransactionsQuery(supabase, { fromDate, toDate, type }, enabled)`

**State**:
- 5 modal-open flags (`isSetupOpen`, `isWithdrawOpen`, `isAdjustOpen`, `isCountOpen`, `detailTxId`)
- `pendingAdjust: { newBalance: number } | null` for Count→Adjust chain
- `fromDate`, `toDate`, `typeFilter` for history filtering

**Composition**:
```tsx
<>
  <SafeBalanceCard
    balance={balance}
    txnCount={transactions.length}
    onSetup={() => setSetupOpen(true)}
    onWithdraw={() => setWithdrawOpen(true)}
    onAdjust={() => setAdjustOpen(true)}
    onCount={() => setCountOpen(true)}
  />
  <SafeHistorySection
    transactions={transactions}
    fromDate={fromDate}
    toDate={toDate}
    typeFilter={typeFilter}
    onFromDateChange={setFromDate}
    onToDateChange={setToDate}
    onTypeFilterChange={setTypeFilter}
    onLoadOlder={() => setFromDate(d => subtractDays(d, 90))}
    onSelectTx={setDetailTxId}
  />
  <SetupSafeModal open={isSetupOpen} onOpenChange={setSetupOpen} />
  <WithdrawSafeModal open={isWithdrawOpen} onOpenChange={setWithdrawOpen} currentBalance={balance} />
  <AdjustSafeModal
    open={isAdjustOpen}
    onOpenChange={(open) => { setAdjustOpen(open); if (!open) setPendingAdjust(null); }}
    currentBalance={balance}
    initialNewBalance={pendingAdjust?.newBalance}
  />
  <CountSafeModal
    open={isCountOpen}
    onOpenChange={setCountOpen}
    onAdjustChain={(newBalance) => {
      setCountOpen(false);
      setPendingAdjust({ newBalance });
      setAdjustOpen(true);
    }}
  />
  <SafeTransactionDetailModal
    open={detailTxId !== null}
    onOpenChange={(open) => { if (!open) setDetailTxId(null); }}
    transactionId={detailTxId}
  />
</>
```

### 4.5 SafeBalanceCard (~80 lines)

- Big balance number (`formatVND(balance)`)
- 4 action buttons in a row:
  - "Setup ban đầu" — only shown if `balance === 0 && txnCount === 0`
  - "Rút khác" — always (when has balance)
  - "Điều chỉnh" — always (when has balance)
  - "Đếm sổ quỹ" — always (when has balance)
- "Sổ quỹ chưa được thiết lập" message if `txnCount === 0`

### 4.6 SafeHistorySection (~200 lines)

- **Filter bar**: 2 date inputs (fromDate, toDate, type=date) + Select for type filter + "Xóa lọc" reset button
- **DataTable** (existing Phase 2 primitive) with columns:
  - `occurred_at` (formatDateTime, sortable)
  - `transaction_type` (Badge with semantic color)
  - `amount` (signed VND, right-aligned, sortable)
  - `reason_category` (text, truncate)
  - `description` (text, truncate)
  - `attachment_count` (Badge count if > 0)
  - Actions: "Xem" button → `onSelectTx(row.id)`
- **"Tải thêm 90 ngày trước" button** below the table → extends fromDate backward
- **Empty state** if no transactions in range

---

## 5. Data flow

### 5.1 On mount (SafeView)
1. Component mounts, gate check passes (owner)
2. `useSafeBalanceQuery` fires → `safe_balance_now()` RPC → balance number
3. `useSafeTransactionsQuery({fromDate: today-90, toDate: today, type: null})` fires → `safe_list_transactions(...)` RPC → array
4. UI renders balance card + history table

### 5.2 Setup flow (first-time)
1. User clicks "Setup ban đầu" → SetupSafeModal opens
2. Fills amount + note → submits
3. `useSetupSafeInitial` mutation → `setupSafeInitial(supabase, amount, note)` → RPC `safe_setup_initial`
4. RPC inserts `safe_transactions` row (transaction_type=`initial_setup`)
5. On success: invalidate `safeBalance` + `["safe","transactions"]` → both queries refetch
6. Modal closes, toast "Đã thiết lập sổ quỹ" shows
7. Balance card updates: balance = amount, txnCount = 1, Setup button hides, other 3 buttons show

### 5.3 Withdraw + attachment flow
1. User clicks "Rút khác" → WithdrawSafeModal opens
2. Fills amount + category + description → "Rút" button
3. Validation: `validateSafeWithdraw(input, balance)` — must not exceed balance
4. `useWithdrawSafeOther` mutation → `withdrawSafeOther(...)` → RPC `safe_withdraw_other`
5. RPC inserts withdraw row, returns `{id, balance_after}`
6. **Modal stays open**: replaces form with attachment UI (`<SafeAttachmentUpload transactionId={result.id} ...>`)
7. User picks file → `useUploadSafeAttachment` mutation → 2-step (storage.upload + safe_attachment_create RPC) → attachment row created
8. User can upload up to 5 files, delete any, then click "Đóng"
9. On close: invalidate `safeBalance` + `["safe","transactions"]` (already done after step 5)

### 5.4 Adjust flow (two-step confirm + attachment)
1. User clicks "Điều chỉnh" → AdjustSafeModal opens (Step 1)
2. Fills newBalance + note (≥5 chars) → "Tiếp" button
3. Modal switches to Step 2: AlertBanner.danger showing change + 2 buttons
4. User clicks "Xác nhận điều chỉnh" → `useAdjustSafe` mutation
5. RPC computes `amount = newBalance - currentBalance`, inserts adjustment row
6. Modal stays open with attachment UI (like withdraw)
7. On close: same invalidation

### 5.5 Count + chain flow
1. User clicks "Đếm sổ quỹ" → CountSafeModal opens
2. Fills DenominationGrid → submits
3. `useCountSafe` mutation → `countSafe(...)` → RPC `safe_count`
4. RPC inserts `safe_counts` row (NOT a safe_transactions row) and returns `{id, total_physical, expected_balance, difference}`
5. Invalidate `safeCounts` only (no balance change)
6. **Modal switches to result view**:
   - `difference === 0` → success message + Close
   - `difference !== 0` → warning + "Điều chỉnh ngay" button
7. If user clicks "Điều chỉnh ngay" → modal closes, parent's `pendingAdjust = {newBalance: total_physical}` → AdjustSafeModal opens with newBalance pre-filled

### 5.6 History filter + load-older flow
1. User changes fromDate → state updates → query key changes → React Query refetches with new args
2. User clicks "Tải thêm 90 ngày trước" → `setFromDate(d => subtractDays(d, 90))` → refetch
3. User clears filter → resets to default last-90-days window

### 5.7 Detail + post-hoc attachment flow
1. User clicks "Xem" on a history row → `setDetailTxId(row.id)` → SafeTransactionDetailModal opens
2. Modal loads txn metadata (already in cache from history list) + attachments via `useQuery(["safe","attachments",txId])`
3. User can upload/delete attachments (subject to 5-cap)
4. Close button → clear `detailTxId`

---

## 6. Error handling

| Scenario | Handling |
|---|---|
| User not authenticated (somehow reaches SafeView) | Defense-in-depth gate: shows EmptyState. NAV_ITEMS upstream blocks this anyway. |
| Manager/staff tries to read safe_transactions directly | RLS blocks (already covered by `070_rls_safe_tables.sql` pgTAP tests) |
| Storage upload fails (bucket misconfig, network) | `uploadSafeAttachment` throws toAppError → mutation `onError` → toast.danger |
| safe_attachment_create RPC fails after upload succeeds | `uploadSafeAttachment` rollbacks storage object (already implemented in data layer line 173) |
| File > 5 MB | Client-side check in `uploadSafeAttachment` throws BEFORE upload (defense-in-depth; storage bucket also enforces 5 MB cap) |
| File MIME not in jpeg/png/heic/heif | Same client-side check + storage bucket enforces |
| Withdraw amount > balance | `validateSafeWithdraw` rejects client-side; RPC also rejects with error message |
| Adjust note < 5 chars | `validateSafeAdjust` rejects client-side; RPC also rejects |
| RPC race condition (concurrent withdraws) | RPC uses `FOR UPDATE` on last txn row (Phase 1 safeguard); UI doesn't pre-emptively re-check |
| Signed URL expires (>1h) | UI re-fetches signed URL on next render; user opening modal after >1h gets fresh URLs |

---

## 7. File Manifest

### 7.1 New files (11)

| Path | Purpose | LOC est. |
|---|---|---|
| `src/components/ui/file-upload-field.tsx` | Phase 2 primitive: hidden input + visible button + clear | 80 |
| `src/hooks/mutations/use-safe-mutations.ts` | 6 hooks (Setup/Withdraw/Adjust/Count/UploadAttachment/DeleteAttachment) | 180 |
| `src/features/safe/safe-view.tsx` | Owner-only container | 250 |
| `src/features/safe/safe-balance-card.tsx` | Balance + 4 action buttons | 80 |
| `src/features/safe/safe-history-section.tsx` | DataTable + filters + load-older | 200 |
| `src/features/safe/safe-attachment-upload.tsx` | Reusable upload component | 150 |
| `src/features/safe/setup-safe-modal.tsx` | First-time setup | 110 |
| `src/features/safe/withdraw-safe-modal.tsx` | Withdraw + inline attachment | 180 |
| `src/features/safe/adjust-safe-modal.tsx` | Two-step adjust + attachment | 170 |
| `src/features/safe/count-safe-modal.tsx` | Denomination snapshot + chain to adjust | 140 |
| `src/features/safe/safe-transaction-detail-modal.tsx` | Txn view + post-hoc attachment | 130 |
| **Total** | | **~1670** |

### 7.2 Modified files (3)

| Path | Change |
|---|---|
| `src/app/page.tsx` | Swap `view === "safe"` placeholder with `<SafeView role={...} businessDate={...} />` (~3 lines) |
| `src/hooks/queries/keys.ts` | Add `safeAttachments: (txId) => ["safe", "attachments", txId]` |
| `src/lib/validation.ts` | Add `validateSafeSetup`, `validateSafeWithdraw`, `validateSafeAdjust` (~40 lines) |

### 7.3 Off-limits (NOT touched)

- All `database/**` (Phase 1 backend frozen)
- `src/lib/data/safe.ts` (data layer frozen — all functions ready)
- `src/lib/types.ts` (Safe types already defined)
- `src/hooks/queries/use-safe-queries.ts` (query hooks already exist)
- `src/features/{navigation,auth,dashboard,reports,pivot,expenses,shifts,cash}/**` (prior-phase features frozen)
- `src/components/ui/{modal,button,text-field,textarea,select,alert-banner,badge,card,data-table,checkbox,icons,toast,spinner,empty-state,stepper,icon-button}.tsx` (Phase 2 primitives frozen — only new addition is file-upload-field)
- `docker-compose.yml`, `.env*`, `vitest.config.mts`, `tsconfig.json`
- All prior `docs/superpowers/**` (referenced, not modified)
- `tools/verify-mirror.mjs` (separate background task is fixing the auth.uid() issue)

---

## 8. Implementation order (task projection)

Final count + structure decided in `writing-plans`. Rough projection (~9 tasks):

1. **T1**: FileUploadField primitive + 3 validators + `use-safe-mutations.ts` (6 hooks) + safeAttachments query key. Smoke test imports compile.
2. **T2**: SafeAttachmentUpload component (reusable; needed before Withdraw/Adjust/Detail modals).
3. **T3**: SetupSafeModal (smallest, no attachments) — template-validating task.
4. **T4**: WithdrawSafeModal (composes attachment upload).
5. **T5**: AdjustSafeModal (two-step confirm + attachment).
6. **T6**: CountSafeModal (DenominationGrid reuse + chain-to-adjust callback).
7. **T7**: SafeBalanceCard + SafeHistorySection (DataTable + windowed pagination).
8. **T8**: SafeTransactionDetailModal (view + post-hoc upload).
9. **T9**: SafeView container + page.tsx wire + final verify:phase + tag `v4-phase-3c1`.

Subagent-driven execution with per-task spec + code reviews — same pattern as 5 successful phases prior.

---

## 9. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| FileUploadField primitive — first file primitive in v4, may have unforeseen design gaps | Medium | Build it in T1 with minimal API (label + accept + onSelect + error + disabled). Use it in T2 (SafeAttachmentUpload) — discover issues early before T4-T8 build on top. |
| Supabase Storage upload fails silently | Medium | Storage bucket already configured (`safe-receipts`, private, 5MB cap, MIME whitelist) per `database/005_storage.sql`. RLS policies for owner-only read/write/delete are already in place. Risk: storage RLS uses `public.app_role()` helper which needs `app_role()` to return 'owner' for the authenticated user — verified working in Phase 3B.2b.ii.b (`070_rls_safe_tables.sql` already tests this). |
| File size + MIME validation must match server-side CHECK constraints | Low | Constants already exported from `src/lib/data/safe.ts` (`SAFE_ATTACHMENT_MAX_FILE_SIZE`, `SAFE_ATTACHMENT_ALLOWED_MIME`). Import in FileUploadField + modals — never hardcode. |
| `safe_balance_now()` race condition on concurrent withdrawals | Low | RPC uses `FOR UPDATE` on the last txn row to serialize. UI doesn't pre-emptively re-check (would add unnecessary latency). React Query refetches after mutation so the new balance shows immediately. |
| Adjust modal: user accidentally clicks "Xác nhận" without reviewing | Medium | Two-step pattern (Step 1 form → Step 2 confirm) makes accidental adjustment require two deliberate clicks. AlertBanner.danger in step 2 shows the exact change. |
| Count → Adjust chain: parent state coordination | Low | Implemented via single `pendingAdjust` state in SafeView. Closing AdjustSafeModal clears it. CountSafeModal exposes `onAdjustChain` callback which sets it. Clean unidirectional flow. |
| Signed URL TTL (1h) — user opens detail modal after 1h, thumbnails 404 | Low | Each render fetches a fresh signed URL via `getSafeAttachmentSignedUrl(path, 3600s)`. No persistent state holds expired URLs. |
| Windowed pagination — user filters to a date range that returns >500 rows | Low | Owner-only data, target shops have <500 safe txns per year. If hit, the DataTable still renders correctly (no virtualization needed for these volumes). Phase 6 can add virtualization. |
| React Query cache pollution from many filter combinations | Low | Default cache GC is 5 min unused. Users typically settle on 1-2 windows; cache stays small. |

---

## 10. Success criteria

- [ ] `npm run verify:phase` exits 0 (75 Vitest + 50 pgTAP unchanged)
- [ ] All 11 new files exist at the spec-mandated paths
- [ ] FileUploadField primitive is minimal and reusable beyond safe (could be used for any future file upload — won't be tied to attachments)
- [ ] All 6 mutation hooks follow the `use-cash-mutations.ts` template (null-supabase guard, invalidate on success)
- [ ] Owner can perform every flow end-to-end: setup, withdraw + attach, adjust w/ confirm + attach, count + chain to adjust, browse history with filter + load-older, view detail + post-hoc attach + delete
- [ ] Manager/staff login: "Sổ quỹ" nav item NOT visible
- [ ] No off-limits files modified (Phase 1 backend, prior-phase features, Phase 2 primitives other than file-upload-field)
- [ ] Commit history: one commit per task (~9 commits), each with `Co-Authored-By: Claude Opus 4.7 (1M context)` footer
- [ ] Final tag `v4-phase-3c1` placed on the merge commit on `main`
- [ ] Phase 3C.2 (Settings) can immediately start by branching off `v4-phase-3c1`

---

## 11. References

- **v3 source** (port-from): `F:\Chill manager\v3\src\features\safe\**` (8 files, ~1.3K lines)
- **Phase 1 backend** (frozen): `database/002_functions.sql:1717-2070` (9 safe RPCs)
- **Phase 1 data layer** (frozen): `src/lib/data/safe.ts` (11 exported functions + constants)
- **Phase 1 storage** (frozen): `database/005_storage.sql` (safe-receipts bucket + RLS policies)
- **Phase 1 query hooks** (frozen): `src/hooks/queries/use-safe-queries.ts`
- **Phase 1 types** (frozen): `src/lib/types.ts` (SafeTransaction, SafeAttachment, SafeCount, etc.)
- **Phase 2 design system**: Modal compound, TextField, Textarea, Select, Card, AlertBanner, Badge, EmptyState, DataTable, Button, IconButton, Icon, Toast — all available
- **Phase 3A**: NAV_ITEMS already gates `safe` to owner-only; page.tsx dispatcher already routes `view === "safe"`
- **Phase 3B.2b.i patterns**: Modal pattern (`opening-cash-modal.tsx`), nested modal (`edit-cash-close-modal.tsx` + `leave-denomination-popup.tsx`), history list (`cash-history-section.tsx`), mutation hooks (`use-cash-mutations.ts`)
- **Phase 3B.2b.ii.b**: pgTAP `070_rls_safe_tables.sql` already validates safe_* RLS — no new pgTAP needed for 3C.1

---

## 12. Out-of-scope notes (preserved for future)

- **Audit log viewer**: All write ops on safe_transactions trigger audit_log entries (Phase 1 trigger). UI to browse these is out of scope; deferred to Phase 4 or later cross-cutting feature.
- **n8n receipt OCR**: `safe_attachments.processed_at` + `extracted_data` columns are reserved for Phase 2 n8n integration that auto-extracts amount/vendor from receipt images. Phase 3C.1 just displays the columns as null.
- **Bulk withdraw / batch adjust**: out of scope. Each operation is one transaction.
- **Export safe history to Excel/PDF**: out of scope; would be Phase 4-5 reporting feature.
- **Comparing safe balance against expected over time** (variance reports): out of scope; would be Phase 5 analytics.
