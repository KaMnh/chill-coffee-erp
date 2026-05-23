# User Management in Settings — Design Spec

**Date:** 2026-05-23
**Branch:** `claude/keen-franklin-bae883`
**Base:** `phase-6a-ci-foundation` (current main)
**Tag at end:** none (feature branch, no phase tag)
**Predecessor:** Phase 3C.2 (Settings module skeleton)

---

## 0. TL;DR

Add an in-app UI that lets owner/manager create, edit, disable, and approve
user accounts without opening Supabase Studio. The HTTP endpoints
(`POST /api/users`, `PATCH /api/users/[id]`, `DELETE /api/users/[id]`) and
data-layer helpers (`createUserAccount`, `updateUserAccount`,
`deactivateUserAccount`) already exist — only the UI and the
`signup_requests` approve/reject endpoints are new.

Two new cards land inside the existing `SettingsView`:

1. **Quản lý tài khoản** — table of `employee_accounts` + "Thêm tài khoản"
   button (opens create modal) + per-row "Sửa" (opens edit modal).
2. **Đơn đăng ký chờ duyệt** — table of pending `signup_requests` rows from
   viewer self-signup (`/login` → sign-up tab), with per-row "Duyệt" (opens
   role-picker modal) and "Từ chối" (inline confirm).

---

## 1. Goal

Deliver an owner/manager-only UI inside `SettingsView` that:

- Lists existing employee accounts with role + status.
- Creates a new account (auth user + employee + employee_account) with a
  caller-chosen role (`owner`, `manager`, `staff_operator`, `employee_viewer`).
- Edits role / status / employee name / position / hourly_rate of an existing
  account.
- Soft-disables an account (no hard delete from `auth.users`).
- Lists pending `signup_requests` and lets owner/manager approve (role chosen
  in modal) or reject.

**Acceptance criteria:**

- Owner login → Settings shows two new cards alongside Sidebar / Handover /
  KiotViet cards.
- "Thêm tài khoản" → modal → fill email / password / name / role /
  position? / hourly_rate? → submit → toast success → table updates.
- New user logs in → sees correct nav per chosen role.
- Per-row "Sửa" → modal preloaded with current values → submit changes →
  table updates.
- Per-row "Disable" → soft sets `status='disabled'` and `is_active=false` →
  user can't sign in fresh sessions (existing JWTs still valid until expiry —
  documented limitation).
- Viewer self-signup at `/login` → owner sees row in "Đơn chờ duyệt" → click
  "Duyệt" → choose role → submit → row moves into accounts table; viewer
  can now log in and reach the app shell.
- "Từ chối" → updates `signup_requests.status='rejected'`; auth user stays
  but `employee_accounts` row never created so they hit the "Tài khoản chờ
  duyệt" landing screen.
- `npm run verify:phase` (Vitest + pgTAP) still passes; new component tests
  green.
- Non-owner/manager who somehow lands on `/api/users*` or
  `/api/signup-requests/*/approve` is rejected with 403 (already covered by
  `requireAuth`).

---

## 2. Non-Goals (deferred)

| Item | Reason / where it lives |
|---|---|
| Hard delete of `auth.users` | Out of scope — keep soft-disable semantics; manual cleanup via Studio if ever needed |
| Force sign-out / token revocation on disable | Defer — accept short JWT TTL window; future enhancement can call `auth.admin.signOut(userId)` |
| Password reset / "send magic link" flow | Defer — user can reset via `/login` Supabase recovery (already supported by Supabase) |
| Email notifications on approve / reject | Defer — owner notifies manually |
| Bulk operations (multi-select disable, bulk role change) | YAGNI for current shop size |
| Audit log inside the UI (who created / modified whom) | DB audit already captures it (see `audit_log`); UI viewer is a separate concern |
| Self-lockout guard beyond minimal protection | Minimal guard included (see §6.4); more elaborate guards (e.g. "last owner" detection) deferred |
| Replacement / migration of `signupViewer` self-signup mode | Out of scope — keep the existing viewer self-signup flow; the new approve UI just consumes its rows |

---

## 3. Architecture

### 3.1 Flow

```
Owner / Manager → SettingsView (existing)
                       │
        ┌──────────────┼───────────────┬───────────────┐
        ▼              ▼               ▼               ▼
 SidebarConfigForm  HandoverDefaults  KiotvietConfig  (existing 3 cards)
                       +
                  AccountsManagerCard      ← NEW
                       │
            ┌──────────┼──────────┐
            ▼          ▼          ▼
       List          Create     Edit
      employee_     Modal       Modal
      accounts      ↓POST       ↓PATCH/DELETE
                  /api/users   /api/users/[id]
                       +
                  SignupRequestsCard       ← NEW
                       │
            ┌──────────┼──────────┐
            ▼          ▼          ▼
        List          Approve   Reject
       pending        Modal     (inline confirm)
      signup_         ↓POST     ↓POST
      requests   approve route  reject route
```

### 3.2 File layout (full picture)

**NEW (9 files):**

```
src/app/api/signup-requests/[id]/
  approve/route.ts           ← POST: create employee + employee_account, status='approved'
  reject/route.ts            ← POST: status='rejected'

src/lib/data/
  signup-requests.ts         ← loadPendingSignupRequests, approveSignupRequest, rejectSignupRequest

src/hooks/queries/
  use-signup-requests-query.ts  ← TanStack query wrapper

src/features/settings/
  accounts-manager-card.tsx  ← Card: list table + "Thêm" button (opens create modal)
  create-account-modal.tsx   ← Modal: form for new user
  edit-account-modal.tsx     ← Modal: form for editing existing user
  signup-requests-card.tsx   ← Card: list pending + per-row Duyệt/Từ chối
  approve-signup-modal.tsx   ← Modal: small role-picker for approve flow
```

**MODIFIED (4 files):**

```
src/features/settings/settings-view.tsx
  + render AccountsManagerCard + SignupRequestsCard
  + load useSignupRequestsQuery + pass data down

src/hooks/mutations/use-settings-mutations.ts
  + useCreateUser, useUpdateUser, useDeactivateUser
  + useApproveSignup, useRejectSignup

src/lib/types.ts
  + SignupRequest type

src/hooks/queries/keys.ts
  + signupRequests: () => ["signup-requests"] as const

src/hooks/queries/index.ts
  + re-export useSignupRequestsQuery
```

(That counts as 5 modifications but `keys.ts` and `index.ts` are 1-liners
each — grouping under "queries" mentally.)

---

## 4. Backend

### 4.1 `POST /api/signup-requests/[id]/approve`

**Auth:** `requireAuth(authHeader, ["owner","manager"])`.
**Path param:** `id` = `signup_requests.id` (uuid).
**Body:** `{ role: "owner" | "manager" | "staff_operator" | "employee_viewer" }`.

**Flow:**

1. Fetch `signup_requests` row by `id`. 404 if missing, 409 if not
   `pending_approval`.
2. Read `auth_user_id`, `email`, `name`, `employee_code` from the request row.
3. If an `employee_accounts` row already exists for `auth_user_id` → 409
   (defensive; should not happen).
4. INSERT into `employees` `{code: employee_code, name, position: null, hourly_rate: 0, is_active: true}` → get id.
5. INSERT into `employee_accounts` `{employee_id, auth_user_id, role, status: 'active'}`.
6. UPSERT `profiles { id: auth_user_id, display_name: name }`.
7. UPDATE `signup_requests SET status='approved', reviewed_by=<jwt sub>, reviewed_at=now()` where id=:id.
8. Best-effort rollback if any of 4–7 fails (delete employees row, etc.) —
   pattern mirrors `POST /api/users`.

**Response:** `{ status: "ok", auth_user_id, employee_id }`.

### 4.2 `POST /api/signup-requests/[id]/reject`

**Auth:** owner/manager.
**Body:** `{ note?: string }`.

**Flow:**

1. Fetch `signup_requests`. 404 / 409 as above.
2. UPDATE `signup_requests SET status='rejected', reviewed_by=<jwt sub>, reviewed_at=now(), note=:note` where id=:id.
3. Do NOT delete `auth.users` row (keep history; user can still try login but
   never gets an `employee_accounts` row → falls through to the "Tài khoản
   chờ duyệt" landing screen forever).

**Response:** `{ status: "ok" }`.

### 4.3 Existing endpoints (no change)

- `POST /api/users` — already does what we need.
- `PATCH /api/users/[id]` — already does what we need.
- `DELETE /api/users/[id]` — already does soft disable.

---

## 5. Data layer

### 5.1 `src/lib/data/signup-requests.ts` (NEW)

```ts
export type SignupRequest = {
  id: string;
  auth_user_id: string | null;
  email: string;
  name: string | null;
  employee_code: string | null;
  status: "pending_email_verification" | "pending_approval" | "approved" | "rejected";
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  note: string | null;
};

// SELECT directly from public.signup_requests via Supabase client.
// RLS already restricts to owner/manager (see 003_rls.sql) — verify
// during impl; if not, add an RPC instead.
export async function loadPendingSignupRequests(supabase): Promise<SignupRequest[]>;
export async function approveSignupRequest(supabase, id, role): Promise<void>;
export async function rejectSignupRequest(supabase, id, note?): Promise<void>;
```

`approve` and `reject` are thin `fetch` wrappers around the new endpoints
(matches the pattern of `createUserAccount` in `src/lib/data/accounts.ts`).

### 5.2 Types

Add `SignupRequest` to `src/lib/types.ts`.

### 5.3 Query / mutation hooks

- `useSignupRequestsQuery(supabase, enabled)` — wraps
  `loadPendingSignupRequests`; key `queryKeys.signupRequests()`;
  `staleTime: 60_000`.

- Extend `src/hooks/mutations/use-settings-mutations.ts`:

  ```ts
  useCreateUser     →  createUserAccount     →  invalidate settingsAccounts
  useUpdateUser     →  updateUserAccount     →  invalidate settingsAccounts (+ account if self)
  useDeactivateUser →  deactivateUserAccount →  invalidate settingsAccounts
  useApproveSignup  →  approveSignupRequest  →  invalidate settingsAccounts + signupRequests
  useRejectSignup   →  rejectSignupRequest   →  invalidate signupRequests
  ```

---

## 6. UI components

### 6.1 `AccountsManagerCard`

**Props:** `{ accounts: SettingsAccount[]; currentUserAuthId: string }`.

Renders a `Card`:

- `CardHeader`: title "Quản lý tài khoản" + subtitle "Tạo, sửa role, vô
  hiệu hoá tài khoản nhân viên." + right-aligned `Button` "Thêm tài khoản".
- `CardBody`: table with columns `Tên | Role | Trạng thái | Hành động`.
  Uses `Badge` for role + status (semantic colors: active=success,
  disabled=neutral).
- Row actions: `Button size="sm" variant="secondary"` "Sửa" → opens
  `EditAccountModal`. Same row has a "Vô hiệu hoá" button (variant=danger
  outlined) → confirm dialog → `useDeactivateUser`. The "Sửa" button stays
  enabled for the current user (they can still edit their own name /
  position / hourly_rate); only the role select inside the modal and the
  "Vô hiệu hoá" button are locked for self (see §6.4).
- Empty state: `EmptyState icon="users" title="Chưa có tài khoản"` (only
  possible right after fresh install — first owner exists via seed).

### 6.2 `CreateAccountModal`

Radix `Dialog` (match `UserSidebarConfigModal` pattern).

Fields:

| Field | Type | Required | Validation |
|---|---|---|---|
| Email | TextField type=email | yes | regex `/^\S+@\S+\.\S+$/` |
| Mật khẩu | TextField type=password | yes | min 8 chars |
| Họ và tên | TextField | yes | trimmed non-empty |
| Vai trò | Select (4 roles, labels from `ROLE_LABELS`) | yes | enum |
| Mã nhân viên | TextField | no | optional |
| Vị trí | TextField | no | optional |
| Lương theo giờ | TextField type=number | no | 0–10,000,000 |

Submit → `useCreateUser.mutateAsync(payload)` → toast success + close. On
error → `AlertBanner variant="danger"` inline with `error.message`.

### 6.3 `EditAccountModal`

Same shape as create but:
- No email / password fields (Supabase Studio still owns those mutations).
- Preloads with current values from the row.
- Submit → `useUpdateUser.mutateAsync({ authUserId, patch })`.
- A "Lưu" button is disabled when no field changed (compare against initial
  state) — small UX nicety, not a hard requirement.

### 6.4 Self-lockout guard (minimal)

Two rules in the UI layer:

- Owner/manager cannot change **their own** role via this UI (the role
  Select inside `EditAccountModal` is disabled when editing self; tooltip:
  "Không tự đổi role chính mình.").
- Owner/manager cannot click "Vô hiệu hoá" on **their own** account
  (button disabled).

These are UI-side only — server side will still accept the request if
called directly. Defense-in-depth would need an RPC check; defer until we
see misuse.

### 6.5 `SignupRequestsCard`

**Props:** `{ requests: SignupRequest[] }`.

- Empty state: hide the entire card (don't render the empty card noisily).
  Show only when `requests.length > 0`.
- Table columns: `Email | Họ tên | Gửi lúc | Hành động`.
- Per row: `Button size="sm" variant="primary"` "Duyệt" → opens
  `ApproveSignupModal`; `Button size="sm" variant="danger"` "Từ chối" →
  inline `confirm()` (Radix `AlertDialog` if available, else simple
  `window.confirm`) → `useRejectSignup.mutateAsync({ id })`.

### 6.6 `ApproveSignupModal`

Tiny dialog:

- Heading: "Duyệt đơn đăng ký".
- Body: read-only summary (email + tên).
- Role `Select` (default `employee_viewer`).
- Submit → `useApproveSignup.mutateAsync({ id, role })` → toast → close.

### 6.7 SettingsView wiring

```tsx
const signupRequestsQuery = useSignupRequestsQuery(supabase, isEnabled);

// ... after isLoading check:

return (
  <div className="space-y-6">
    <SidebarConfigForm {...} />
    <AccountsManagerCard
      accounts={accounts}
      currentUserAuthId={currentAccount.auth_user_id}
    />
    <SignupRequestsCard requests={signupRequestsQuery.data ?? []} />
    <HandoverDefaultTasksEditor tasks={appSettings.handover_default_tasks} />
    <KiotvietConfigForm />
  </div>
);
```

Ordering rationale: accounts management is more frequently used than
handover task editing → put it higher; signup requests is conditional
(empty-state hidden) so visual stack collapses cleanly.

---

## 7. Data flow examples

### 7.1 Create user

```
Owner clicks "Thêm tài khoản"
  → CreateAccountModal opens
  → user fills form, clicks "Tạo"
  → useCreateUser.mutateAsync({ email, password, name, role, position, hourly_rate, code })
  → createUserAccount → POST /api/users (Bearer access_token)
  → server: requireAuth → admin.createUser → INSERT employees → INSERT employee_accounts → UPSERT profiles
  → 200 { status:"ok", auth_user_id, employee_id }
  → onSuccess: invalidate ["settings-accounts"]
  → toast.success("Đã tạo tài khoản…"), modal closes
  → table re-renders with new row
```

### 7.2 Approve signup

```
Owner clicks "Duyệt" on a pending row
  → ApproveSignupModal opens (id, email, name preloaded)
  → owner picks role, clicks "Duyệt"
  → useApproveSignup.mutateAsync({ id, role })
  → POST /api/signup-requests/[id]/approve { role }
  → server: requireAuth → fetch signup_requests row → INSERT employees + employee_accounts + UPSERT profiles
                     → UPDATE signup_requests.status='approved'
  → 200 { status:"ok", auth_user_id, employee_id }
  → onSuccess: invalidate ["settings-accounts","signup-requests"]
  → toast.success, modal closes, both tables re-render
```

---

## 8. Security checklist (per supabase skill)

| Item | Status |
|---|---|
| Service-role key never on client | ✓ All admin ops via API route, service-role client server-side only |
| Auth via `app_metadata` / DB lookup, not `user_metadata` | ✓ `requireAuth` checks `employee_accounts.role` |
| RLS on `signup_requests` allows only owner/manager SELECT | ⚠ verify during impl; check `database/003_rls.sql`. If not, ship via RPC `list_pending_signup_requests` instead |
| Token revocation on disable | ✗ NOT implemented (documented limitation, §1 acceptance criteria) |
| Password ≥ 8 server-side | ✓ already in `POST /api/users` |
| Email format server-side | ✓ already in `POST /api/users` |
| Role enum server-side | ✓ already in both `POST /api/users` and new approve route |

If §8 row 3 turns up "RLS doesn't allow this", we switch from direct table
read to an RPC. Cost: one extra SQL function; no UI change.

---

## 9. Testing strategy

### 9.1 Vitest (component / unit)

- `create-account-modal.test.tsx`: render → fill invalid email → submit →
  expect inline error; fill valid form → submit → expect mutationFn called
  with correct payload.
- `edit-account-modal.test.tsx`: preload values → toggle role → submit →
  expect mutationFn called with `{ role: newValue }`; for self-edit, role
  select is disabled.
- `approve-signup-modal.test.tsx`: pick role → submit → expect mutationFn
  called.
- `signup-requests-card.test.tsx`: empty array → card not rendered; one
  pending → row present with two buttons.

(All use the existing Vitest setup — no infra changes.)

### 9.2 pgTAP

No new SQL — existing schema is unchanged. Existing `signup_requests` and
`employee_accounts` pgTAP coverage stays as-is.

### 9.3 Manual smoke (after implementation)

Documented in the implementation plan, executed by the reviewer:

1. Owner logs in → Settings shows new cards.
2. Create user with `role=manager`, password `manager-pass-123` → log out
   → log in as that user → sidebar matches manager defaults.
3. New manager opens Settings → also sees user management cards.
4. Viewer self-signs-up at `/login` → logs out → owner sees one pending in
   "Đơn chờ duyệt" → approve as `staff_operator` → viewer logs in → sees
   staff-operator nav.
5. Owner clicks "Vô hiệu hoá" on the staff_operator → confirm → toast →
   row shows status="disabled" → that user can no longer create new
   sessions (after current JWT expires).
6. Reject path: viewer self-signs-up again → owner clicks "Từ chối" →
   viewer can attempt login but lands on "Tài khoản chờ duyệt" forever.

---

## 10. Open questions / explicit tradeoffs

1. **RLS on `signup_requests`** — verify during implementation. If the
   `authenticated` role does not have SELECT, we route the list through an
   RPC. Decision deferred to impl.
2. **AlertDialog for reject confirmation** — codebase doesn't seem to have
   a shared `AlertDialog` primitive yet. Fallback: native `window.confirm`
   first, upgrade later. (One-line UI change if we add AlertDialog.)
3. **Race: two managers approve the same request** — second wins gets a
   409 from the endpoint; we surface it as a toast. Acceptable.
4. **Owner deletion of last owner** — out of scope per §2. Operator must be
   careful; if it ever happens, manual fix via Studio.

---

## 11. Implementation order (proposed)

1. Types + queryKeys + data layer (`signup-requests.ts`) — pure code.
2. Two new API routes (approve / reject) — server-side.
3. Query hook + mutation hooks.
4. Components from leaf inward: modals → cards → SettingsView wiring.
5. Component tests alongside each component file.
6. Manual smoke per §9.3.

This is what the implementation plan (next step via `writing-plans`
skill) will expand into TDD-flavoured tasks with explicit verify steps.
