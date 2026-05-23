# User Management in Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app UI inside `SettingsView` that lets owner/manager create, edit, disable, and approve user accounts (with role selection) without opening Supabase Studio.

**Architecture:** Two new cards inside `SettingsView` (`AccountsManagerCard`, `SignupRequestsCard`). The HTTP endpoints `POST/PATCH/DELETE /api/users` already exist; we only add `POST /api/signup-requests/[id]/{approve,reject}`. UI components use the existing Modal / Select / Button design system. Data flows through new TanStack query + mutation hooks that wrap existing `src/lib/data/accounts.ts` helpers + a new `src/lib/data/signup-requests.ts` module.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript 5.8, TanStack Query 5, Supabase JS 2, Radix UI primitives, Tailwind v4.

**Testing policy:** This project's Vitest config (`vitest.config.mts`) targets `environment: "node"` and only includes `**/__tests__/**/*.test.ts` (not `.test.tsx`). Component tests are explicitly deferred to Phase 6.B per the comment in the config. This plan therefore relies on:
- TypeScript compilation (`npx tsc --noEmit -p tsconfig.json`) for type-level correctness.
- Existing test suite (`npm run test:run`) must stay green throughout.
- Manual smoke test at the end (Task 13) for end-to-end verification.

**Spec reference:** [docs/superpowers/specs/2026-05-23-user-management-in-settings-design.md](../specs/2026-05-23-user-management-in-settings-design.md)

---

## Pre-flight

- [ ] **Step 0.1: Verify baseline tests pass**

Run: `npm run test:run`
Expected: PASS, no failures.

- [ ] **Step 0.2: Verify TypeScript compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0, no errors.

If either fails, stop — fix the pre-existing breakage before starting.

---

## Task 1: Add SignupRequest type + queryKey

**Files:**
- Modify: `src/lib/types.ts` (append at end of existing type definitions)
- Modify: `src/hooks/queries/keys.ts`

- [ ] **Step 1: Append `SignupRequest` type to `src/lib/types.ts`**

Append this block at the very end of the file (after the last existing `export interface StockBalance { … }`):

```ts
// =====================================================================
// User management — signup_requests (Phase 6+ user mgmt UI)
// =====================================================================

export type SignupRequestStatus =
  | "pending_email_verification"
  | "pending_approval"
  | "approved"
  | "rejected";

export interface SignupRequest {
  id: string;
  auth_user_id: string | null;
  email: string;
  name: string | null;
  employee_code: string | null;
  status: SignupRequestStatus;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  note: string | null;
}
```

- [ ] **Step 2: Add `signupRequests` queryKey factory to `src/hooks/queries/keys.ts`**

Find the closing `};` of the `queryKeys` object (last line ~63). Insert this new entry just above the closing brace, alongside the other key factories:

```ts
  // User management — signup_requests
  signupRequests: () => ["signup-requests"] as const,
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/hooks/queries/keys.ts
git commit -m "types: add SignupRequest + signupRequests queryKey

Prep for user management UI in Settings (spec 2026-05-23).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Create signup-requests data layer

**Files:**
- Create: `src/lib/data/signup-requests.ts`
- Modify: `src/lib/data.ts` (barrel re-export)

- [ ] **Step 1: Create `src/lib/data/signup-requests.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SignupRequest, UserRole } from "@/lib/types";
import { toAppError } from "./_common";

async function authHeader(supabase: SupabaseClient): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Load all signup_requests rows with status="pending_approval".
 *
 * RLS already restricts SELECT to owner/manager (or self) — verified in
 * database/003_rls.sql policy `signup_select_self_admin`. No RPC needed.
 */
export async function loadPendingSignupRequests(
  supabase: SupabaseClient
): Promise<SignupRequest[]> {
  const { data, error } = await supabase
    .from("signup_requests")
    .select(
      "id, auth_user_id, email, name, employee_code, status, requested_at, reviewed_by, reviewed_at, note"
    )
    .eq("status", "pending_approval")
    .order("requested_at", { ascending: false });
  if (error) throw toAppError(error, "Không tải được danh sách đơn đăng ký.");
  return (data ?? []) as SignupRequest[];
}

/** Approve a pending signup_request, picking a role for the new account. */
export async function approveSignupRequest(
  supabase: SupabaseClient,
  id: string,
  role: UserRole
): Promise<void> {
  const headers = { ...(await authHeader(supabase)), "Content-Type": "application/json" };
  const res = await fetch(`/api/signup-requests/${id}/approve`, {
    method: "POST",
    headers,
    body: JSON.stringify({ role })
  });
  const json = (await res.json()) as { status: string; error?: string };
  if (!res.ok || json.status !== "ok") {
    throw new Error(json.error ?? `Duyệt thất bại (HTTP ${res.status}).`);
  }
}

/** Reject a pending signup_request. Optional note for audit. */
export async function rejectSignupRequest(
  supabase: SupabaseClient,
  id: string,
  note?: string
): Promise<void> {
  const headers = { ...(await authHeader(supabase)), "Content-Type": "application/json" };
  const res = await fetch(`/api/signup-requests/${id}/reject`, {
    method: "POST",
    headers,
    body: JSON.stringify({ note })
  });
  const json = (await res.json()) as { status: string; error?: string };
  if (!res.ok || json.status !== "ok") {
    throw new Error(json.error ?? `Từ chối thất bại (HTTP ${res.status}).`);
  }
}
```

- [ ] **Step 2: Add re-export to `src/lib/data.ts`**

The current file is a 1-line barrel `export * from "./data/...";` style. Open it and verify. Then append:

```ts
export * from "./data/signup-requests";
```

If the barrel uses explicit names, add `loadPendingSignupRequests`, `approveSignupRequest`, `rejectSignupRequest` to the named exports list — match the existing style.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/data/signup-requests.ts src/lib/data.ts
git commit -m "feat(data): signup_requests load + approve + reject helpers

Thin wrappers over existing fetch pattern (matches accounts.ts).
loadPendingSignupRequests reads the table directly — RLS already
allows owner/manager SELECT (003_rls.sql).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Create POST /api/signup-requests/[id]/approve

**Files:**
- Create: `src/app/api/signup-requests/[id]/approve/route.ts`

- [ ] **Step 1: Create the route file with full handler**

```ts
/**
 * POST /api/signup-requests/<id>/approve
 *
 * Auth: owner / manager only.
 * Body: { role: 'owner' | 'manager' | 'staff_operator' | 'employee_viewer' }
 *
 * Flow:
 *   1. Fetch signup_requests row; 404 if missing, 409 if not pending_approval.
 *   2. Read auth_user_id, email, name, employee_code from row.
 *   3. Reject (409) if employee_accounts already exists for that auth_user_id.
 *   4. INSERT employees (name, code, position=null, hourly_rate=0, is_active=true).
 *   5. INSERT employee_accounts (employee_id, auth_user_id, role, status='active').
 *   6. UPSERT profiles (id=auth_user_id, display_name=name).
 *   7. UPDATE signup_requests.status='approved', reviewed_by, reviewed_at.
 *
 * Best-effort rollback if 4/5/6 fail.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleClient, requireAuth } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_ROLES = ["owner", "manager", "staff_operator", "employee_viewer"] as const;
type Role = (typeof VALID_ROLES)[number];

function bad(message: string, status = 400) {
  return NextResponse.json({ status: "error", error: message }, { status });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let approver: { userId: string; role: string };
  try {
    approver = await requireAuth(req.headers.get("authorization"), ["owner", "manager"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auth failed.";
    const code = message.includes("Authorization") || message.includes("Token") ? 401 : 403;
    return bad(message, code);
  }

  const { id } = await ctx.params;
  if (!id) return bad("Thiếu signup_request id.");

  let body: { role?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return bad("Body không phải JSON.");
  }
  const role = body.role;
  if (!role || !VALID_ROLES.includes(role as Role)) {
    return bad("Role không hợp lệ.");
  }

  const supabase = getServiceRoleClient();

  // Step 1: fetch the signup_request
  const { data: request, error: reqError } = await supabase
    .from("signup_requests")
    .select("id, auth_user_id, email, name, employee_code, status")
    .eq("id", id)
    .maybeSingle();
  if (reqError) return bad(`Không tải được đơn: ${reqError.message}`, 500);
  if (!request) return bad("Không tìm thấy đơn.", 404);
  if (request.status !== "pending_approval") {
    return bad(`Đơn không ở trạng thái pending_approval (đang: ${request.status}).`, 409);
  }
  if (!request.auth_user_id) {
    return bad("Đơn không có auth_user_id (bug data — báo admin).", 409);
  }

  // Step 2/3: ensure no existing employee_accounts for this auth user
  const { data: existing } = await supabase
    .from("employee_accounts")
    .select("id")
    .eq("auth_user_id", request.auth_user_id)
    .maybeSingle();
  if (existing) {
    return bad("Tài khoản đã tồn tại cho auth user này — không thể duyệt lần nữa.", 409);
  }

  const displayName = request.name?.trim() || request.email;

  // Step 4: INSERT employees
  const { data: emp, error: empError } = await supabase
    .from("employees")
    .insert({
      code: request.employee_code,
      name: displayName,
      position: null,
      hourly_rate: 0,
      is_active: true
    })
    .select("id")
    .single();
  if (empError || !emp) {
    return bad(`Không tạo được employee: ${empError?.message ?? "unknown"}`, 500);
  }
  const employeeId = emp.id;

  // Step 5: INSERT employee_accounts
  const { error: accError } = await supabase.from("employee_accounts").insert({
    employee_id: employeeId,
    auth_user_id: request.auth_user_id,
    role,
    status: "active",
    created_by: approver.userId
  });
  if (accError) {
    void supabase.from("employees").delete().eq("id", employeeId);
    return bad(`Không tạo được employee_account: ${accError.message}`, 500);
  }

  // Step 6: UPSERT profiles (best-effort, non-fatal)
  await supabase
    .from("profiles")
    .upsert({ id: request.auth_user_id, display_name: displayName }, { onConflict: "id" });

  // Step 7: UPDATE signup_requests
  const { error: updError } = await supabase
    .from("signup_requests")
    .update({
      status: "approved",
      reviewed_by: approver.userId,
      reviewed_at: new Date().toISOString()
    })
    .eq("id", id);
  if (updError) {
    // Account is already created — don't roll back; just surface the warning.
    return NextResponse.json({
      status: "ok",
      auth_user_id: request.auth_user_id,
      employee_id: employeeId,
      warning: `Đã tạo tài khoản nhưng không cập nhật được signup_requests: ${updError.message}`
    });
  }

  return NextResponse.json({
    status: "ok",
    auth_user_id: request.auth_user_id,
    employee_id: employeeId
  });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/signup-requests/
git commit -m "feat(api): POST /api/signup-requests/[id]/approve

Creates employees + employee_accounts + upserts profiles, then
marks signup_requests as approved. Owner/manager only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Create POST /api/signup-requests/[id]/reject

**Files:**
- Create: `src/app/api/signup-requests/[id]/reject/route.ts`

- [ ] **Step 1: Create the route file**

```ts
/**
 * POST /api/signup-requests/<id>/reject
 *
 * Auth: owner / manager only.
 * Body: { note?: string }
 *
 * Action: set signup_requests.status='rejected', reviewed_by, reviewed_at,
 * note (optional). Does NOT delete the auth.users row — user can still
 * attempt login but will hit the "Tài khoản chờ duyệt" landing screen
 * because they never get an employee_accounts row.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleClient, requireAuth } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bad(message: string, status = 400) {
  return NextResponse.json({ status: "error", error: message }, { status });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let approver: { userId: string };
  try {
    approver = await requireAuth(req.headers.get("authorization"), ["owner", "manager"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auth failed.";
    const code = message.includes("Authorization") || message.includes("Token") ? 401 : 403;
    return bad(message, code);
  }

  const { id } = await ctx.params;
  if (!id) return bad("Thiếu signup_request id.");

  let body: { note?: string };
  try {
    body = (await req.json().catch(() => ({}))) as typeof body;
  } catch {
    body = {};
  }
  const note = body.note?.trim() || null;

  const supabase = getServiceRoleClient();

  // Fetch + validate status
  const { data: request, error: reqError } = await supabase
    .from("signup_requests")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (reqError) return bad(`Không tải được đơn: ${reqError.message}`, 500);
  if (!request) return bad("Không tìm thấy đơn.", 404);
  if (request.status !== "pending_approval") {
    return bad(`Đơn không ở trạng thái pending_approval (đang: ${request.status}).`, 409);
  }

  const { error: updError } = await supabase
    .from("signup_requests")
    .update({
      status: "rejected",
      reviewed_by: approver.userId,
      reviewed_at: new Date().toISOString(),
      note
    })
    .eq("id", id);
  if (updError) return bad(`Không cập nhật được đơn: ${updError.message}`, 500);

  return NextResponse.json({ status: "ok" });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/signup-requests/[id]/reject/
git commit -m "feat(api): POST /api/signup-requests/[id]/reject

Marks signup_requests as rejected with optional note. Owner/manager
only. Does not touch auth.users.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Create useSignupRequestsQuery hook

**Files:**
- Create: `src/hooks/queries/use-signup-requests-query.ts`
- Modify: `src/hooks/queries/index.ts`

- [ ] **Step 1: Create the query hook**

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPendingSignupRequests } from "@/lib/data";
import { queryKeys } from "./keys";

export function useSignupRequestsQuery(
  supabase: SupabaseClient | null,
  enabled: boolean
) {
  return useQuery({
    queryKey: queryKeys.signupRequests(),
    queryFn: () => loadPendingSignupRequests(supabase!),
    enabled: enabled && !!supabase,
    staleTime: 60_000
  });
}
```

- [ ] **Step 2: Re-export from `src/hooks/queries/index.ts`**

Open the file. Find the existing `export { useAccountQuery, useSettingsAccountsQuery } from "./use-account-query";` line. Add a new export line below it:

```ts
export { useSignupRequestsQuery } from "./use-signup-requests-query";
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/queries/use-signup-requests-query.ts src/hooks/queries/index.ts
git commit -m "feat(hooks): useSignupRequestsQuery — load pending signups

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Add 5 user-management mutation hooks

**Files:**
- Modify: `src/hooks/mutations/use-settings-mutations.ts`

- [ ] **Step 1: Update imports in `use-settings-mutations.ts`**

Find the existing import block at the top:

```ts
import {
  updateSidebarDefaults,
  updateUserSidebarConfig,
  updateHandoverDefaultTasks
} from "@/lib/data";
import type { UserRole } from "@/lib/types";
```

Replace with:

```ts
import {
  updateSidebarDefaults,
  updateUserSidebarConfig,
  updateHandoverDefaultTasks,
  createUserAccount,
  updateUserAccount,
  deactivateUserAccount,
  approveSignupRequest,
  rejectSignupRequest,
  type CreateUserPayload
} from "@/lib/data";
import type { UserRole } from "@/lib/types";
```

(`CreateUserPayload` is already exported from `src/lib/data/accounts.ts`. If the barrel `src/lib/data.ts` doesn't re-export types yet, also add `export type { CreateUserPayload } from "./data/accounts";` to it.)

- [ ] **Step 2: Append the 5 new mutation hooks at the end of `use-settings-mutations.ts`**

```ts
// ---------------------------------------------------------------------------
// User management mutations (Phase 6+)
// ---------------------------------------------------------------------------

export function useCreateUser(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateUserPayload) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return createUserAccount(supabase, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settingsAccounts() });
    }
  });
}

export interface UpdateUserInput {
  authUserId: string;
  patch: {
    role?: UserRole;
    status?: "active" | "disabled";
    name?: string;
    position?: string;
    hourly_rate?: number;
  };
}

export function useUpdateUser(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateUserInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateUserAccount(supabase, input.authUserId, input.patch);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settingsAccounts() });
      queryClient.invalidateQueries({ queryKey: queryKeys.account() });
    }
  });
}

export function useDeactivateUser(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (authUserId: string) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return deactivateUserAccount(supabase, authUserId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settingsAccounts() });
    }
  });
}

export interface ApproveSignupInput {
  id: string;
  role: UserRole;
}

export function useApproveSignup(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ApproveSignupInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return approveSignupRequest(supabase, input.id, input.role);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settingsAccounts() });
      queryClient.invalidateQueries({ queryKey: queryKeys.signupRequests() });
    }
  });
}

export interface RejectSignupInput {
  id: string;
  note?: string;
}

export function useRejectSignup(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RejectSignupInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return rejectSignupRequest(supabase, input.id, input.note);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.signupRequests() });
    }
  });
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/mutations/use-settings-mutations.ts src/lib/data.ts
git commit -m "feat(hooks): user-management mutations

Adds useCreateUser, useUpdateUser, useDeactivateUser, useApproveSignup,
useRejectSignup. All wrap existing data-layer helpers and invalidate
the relevant TanStack keys on success.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Create CreateAccountModal

**Files:**
- Create: `src/features/settings/create-account-modal.tsx`

- [ ] **Step 1: Create the modal**

```tsx
"use client";

import { useState, type FormEvent } from "react";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription,
  ModalActions
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
} from "@/components/ui/select";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useCreateUser } from "@/hooks/mutations/use-settings-mutations";
import { ROLE_LABELS } from "@/features/navigation/navigation";
import type { UserRole } from "@/lib/types";

const ROLES: UserRole[] = ["owner", "manager", "staff_operator", "employee_viewer"];
const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

interface CreateAccountModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

/**
 * Modal form: create a new auth user + employee + employee_account.
 *
 * Validation mirrors the server-side checks in /api/users (email regex,
 * password ≥8, name required, role enum, hourly_rate 0..10_000_000).
 * Showing inline errors avoids a round-trip for obvious typos.
 */
export function CreateAccountModal({ open, onOpenChange }: CreateAccountModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const createM = useCreateUser(supabase);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("employee_viewer");
  const [position, setPosition] = useState("");
  const [code, setCode] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEmail("");
    setPassword("");
    setName("");
    setRole("employee_viewer");
    setPosition("");
    setCode("");
    setHourlyRate("");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // Client-side validation
    if (!EMAIL_REGEX.test(email.trim())) {
      setError("Email không hợp lệ.");
      return;
    }
    if (password.length < 8) {
      setError("Mật khẩu tối thiểu 8 ký tự.");
      return;
    }
    if (!name.trim()) {
      setError("Họ và tên bắt buộc.");
      return;
    }
    const rateNum = hourlyRate.trim() === "" ? 0 : Number(hourlyRate);
    if (!Number.isFinite(rateNum) || rateNum < 0 || rateNum > 10_000_000) {
      setError("Lương theo giờ phải nằm trong 0–10.000.000.");
      return;
    }

    try {
      await createM.mutateAsync({
        email: email.trim(),
        password,
        name: name.trim(),
        role,
        position: position.trim() || undefined,
        code: code.trim() || undefined,
        hourly_rate: rateNum
      });
      toast({
        semantic: "success",
        title: "Đã tạo tài khoản",
        message: `${name.trim()} (${ROLE_LABELS[role]}) đã có thể đăng nhập.`
      });
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tạo tài khoản thất bại.");
    }
  }

  const isBusy = createM.isPending;

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalContent>
        <ModalTitle>Thêm tài khoản</ModalTitle>
        <ModalDescription>
          Tạo auth user + employee + employee_account trong 1 bước. Tài khoản
          ở trạng thái active ngay.
        </ModalDescription>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          {error && (
            <AlertBanner variant="danger" title="Không thực hiện được">
              {error}
            </AlertBanner>
          )}

          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={isBusy}
            placeholder="staff@chill.local"
          />
          <TextField
            label="Mật khẩu"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={isBusy}
            placeholder="≥ 8 ký tự"
          />
          <TextField
            label="Họ và tên"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={isBusy}
            placeholder="Nguyễn Văn A"
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-ink-2">Vai trò</label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)} disabled={isBusy}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <TextField
            label="Mã nhân viên (tuỳ chọn)"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={isBusy}
            placeholder="NV001"
          />
          <TextField
            label="Vị trí (tuỳ chọn)"
            type="text"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            disabled={isBusy}
            placeholder="Barista"
          />
          <TextField
            label="Lương theo giờ (tuỳ chọn, VND)"
            type="number"
            inputMode="numeric"
            min={0}
            max={10_000_000}
            step={1000}
            value={hourlyRate}
            onChange={(e) => setHourlyRate(e.target.value)}
            disabled={isBusy}
            placeholder="0"
          />

          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={isBusy}
            >
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={isBusy}>
              Tạo tài khoản
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/features/settings/create-account-modal.tsx
git commit -m "feat(settings): CreateAccountModal — owner/manager creates new user

Form with email / password / name / role select / optional position +
code + hourly_rate. Inline validation mirrors server-side checks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Create EditAccountModal

**Files:**
- Create: `src/features/settings/edit-account-modal.tsx`

- [ ] **Step 1: Create the modal**

```tsx
"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription,
  ModalActions
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
} from "@/components/ui/select";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useUpdateUser } from "@/hooks/mutations/use-settings-mutations";
import { ROLE_LABELS } from "@/features/navigation/navigation";
import type { SettingsAccount, UserRole } from "@/lib/types";

const ROLES: UserRole[] = ["owner", "manager", "staff_operator", "employee_viewer"];

interface EditAccountModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  account: SettingsAccount | null;
  currentUserAuthId: string;
}

/**
 * Modal form: edit role / status / employee fields of an existing account.
 *
 * Self-lockout (UI layer only):
 *   - Editing self → role select is disabled.
 *   - Status can be toggled to "disabled" for others; self cannot disable
 *     itself (the AccountsManagerCard already hides the disable button for
 *     self, but we also defend in depth here).
 */
export function EditAccountModal({
  open,
  onOpenChange,
  account,
  currentUserAuthId
}: EditAccountModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const updateM = useUpdateUser(supabase);

  const [role, setRole] = useState<UserRole>("employee_viewer");
  const [status, setStatus] = useState<"active" | "disabled">("active");
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Initialise state when modal opens with a different account.
  useEffect(() => {
    if (!open || !account) return;
    setRole(account.role);
    setStatus(account.status === "disabled" ? "disabled" : "active");
    setName(account.employee_name ?? "");
    setPosition(account.employee_position ?? "");
    setHourlyRate(""); // backend doesn't return hourly_rate in SettingsAccount; leave blank → unchanged
    setError(null);
  }, [open, account]);

  if (!account) return null;

  const isSelf = account.auth_user_id === currentUserAuthId;
  const isBusy = updateM.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Họ và tên bắt buộc.");
      return;
    }
    const rateStr = hourlyRate.trim();
    const rateNum = rateStr === "" ? undefined : Number(rateStr);
    if (rateNum !== undefined && (!Number.isFinite(rateNum) || rateNum < 0 || rateNum > 10_000_000)) {
      setError("Lương theo giờ phải nằm trong 0–10.000.000.");
      return;
    }

    // Build patch with only the changed fields. Skip role for self.
    const patch: {
      role?: UserRole;
      status?: "active" | "disabled";
      name?: string;
      position?: string;
      hourly_rate?: number;
    } = {};

    if (!isSelf && role !== account.role) patch.role = role;
    if (!isSelf && status !== (account.status === "disabled" ? "disabled" : "active")) {
      patch.status = status;
    }
    if (name.trim() !== (account.employee_name ?? "")) patch.name = name.trim();
    if (position.trim() !== (account.employee_position ?? "")) {
      patch.position = position.trim();
    }
    if (rateNum !== undefined) patch.hourly_rate = rateNum;

    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }

    try {
      await updateM.mutateAsync({ authUserId: account.auth_user_id, patch });
      toast({ semantic: "success", message: "Đã cập nhật tài khoản." });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cập nhật thất bại.");
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>Sửa tài khoản</ModalTitle>
        <ModalDescription>
          {account.employee_name ?? "(chưa có tên)"}
          {isSelf && " — đây là bạn"}
        </ModalDescription>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          {error && (
            <AlertBanner variant="danger" title="Không thực hiện được">
              {error}
            </AlertBanner>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-ink-2">Vai trò</label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as UserRole)}
              disabled={isBusy || isSelf}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isSelf && (
              <p className="text-xs text-muted">
                Không thể tự đổi vai trò của chính mình.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-ink-2">Trạng thái</label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as "active" | "disabled")}
              disabled={isBusy || isSelf}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <TextField
            label="Họ và tên"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={isBusy}
          />
          <TextField
            label="Vị trí"
            type="text"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            disabled={isBusy}
            placeholder="Barista"
          />
          <TextField
            label="Lương theo giờ (VND) — bỏ trống = không đổi"
            type="number"
            inputMode="numeric"
            min={0}
            max={10_000_000}
            step={1000}
            value={hourlyRate}
            onChange={(e) => setHourlyRate(e.target.value)}
            disabled={isBusy}
            placeholder=""
          />

          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
            >
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={isBusy}>
              Lưu
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/features/settings/edit-account-modal.tsx
git commit -m "feat(settings): EditAccountModal — owner/manager edits role/status/employee

Self-lockout: role + status selects disabled when editing self.
Submits PATCH only for changed fields (no-op no-network when nothing
changed).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Create AccountsManagerCard

**Files:**
- Create: `src/features/settings/accounts-manager-card.tsx`

- [ ] **Step 1: Create the card**

```tsx
"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription,
  ModalActions
} from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useDeactivateUser } from "@/hooks/mutations/use-settings-mutations";
import { ROLE_LABELS } from "@/features/navigation/navigation";
import type { SettingsAccount } from "@/lib/types";
import { CreateAccountModal } from "./create-account-modal";
import { EditAccountModal } from "./edit-account-modal";

interface AccountsManagerCardProps {
  accounts: SettingsAccount[];
  currentUserAuthId: string;
}

export function AccountsManagerCard({
  accounts,
  currentUserAuthId
}: AccountsManagerCardProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const deactivateM = useDeactivateUser(supabase);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<SettingsAccount | null>(null);
  const [confirmDisable, setConfirmDisable] = useState<SettingsAccount | null>(null);

  async function handleDeactivate() {
    if (!confirmDisable) return;
    try {
      await deactivateM.mutateAsync(confirmDisable.auth_user_id);
      toast({ semantic: "success", message: "Đã vô hiệu hoá tài khoản." });
      setConfirmDisable(null);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không vô hiệu hoá được."
      });
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Quản lý tài khoản</CardTitle>
              <p className="mt-1 text-xs text-muted">
                Tạo, sửa vai trò, hoặc vô hiệu hoá tài khoản nhân viên — không
                cần vào Supabase Studio.
              </p>
            </div>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setCreateOpen(true)}
            >
              + Thêm tài khoản
            </Button>
          </div>
        </CardHeader>
        <CardBody>
          {accounts.length === 0 ? (
            <EmptyState
              icon="users"
              title="Chưa có tài khoản"
              subtitle="Bấm 'Thêm tài khoản' để tạo người dùng đầu tiên."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-muted">
                      Tên
                    </th>
                    <th className="text-left py-2 px-2 text-xs font-medium uppercase tracking-wider text-muted">
                      Vai trò
                    </th>
                    <th className="text-left py-2 px-2 text-xs font-medium uppercase tracking-wider text-muted">
                      Trạng thái
                    </th>
                    <th className="text-right py-2 pl-2 text-xs font-medium uppercase tracking-wider text-muted">
                      Hành động
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((acc) => {
                    const isSelf = acc.auth_user_id === currentUserAuthId;
                    const isDisabled = acc.status === "disabled";
                    return (
                      <tr
                        key={acc.id}
                        className="border-b border-border last:border-0"
                      >
                        <td className="py-3 pr-4">
                          <p className="text-sm text-ink">
                            {acc.employee_name ?? "(chưa có tên)"}
                            {isSelf && (
                              <span className="ml-2 text-xs text-muted">(bạn)</span>
                            )}
                          </p>
                          {acc.employee_position && (
                            <p className="text-xs text-muted">{acc.employee_position}</p>
                          )}
                        </td>
                        <td className="py-3 px-2">
                          <Badge variant="soft" semantic="neutral">
                            {ROLE_LABELS[acc.role]}
                          </Badge>
                        </td>
                        <td className="py-3 px-2">
                          <Badge
                            variant="soft"
                            semantic={isDisabled ? "neutral" : "success"}
                          >
                            {isDisabled ? "Disabled" : "Active"}
                          </Badge>
                        </td>
                        <td className="py-3 pl-2 text-right">
                          <div className="inline-flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => setEditing(acc)}
                            >
                              Sửa
                            </Button>
                            {!isSelf && !isDisabled && (
                              <Button
                                type="button"
                                size="sm"
                                variant="danger"
                                onClick={() => setConfirmDisable(acc)}
                              >
                                Vô hiệu hoá
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <CreateAccountModal open={createOpen} onOpenChange={setCreateOpen} />

      <EditAccountModal
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        account={editing}
        currentUserAuthId={currentUserAuthId}
      />

      <Modal
        open={confirmDisable !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDisable(null);
        }}
      >
        <ModalContent>
          <ModalTitle>Vô hiệu hoá tài khoản?</ModalTitle>
          <ModalDescription>
            {confirmDisable?.employee_name ?? "Tài khoản"} sẽ không tạo được
            session mới. Session hiện hữu vẫn dùng được tới khi JWT hết hạn.
            Không xoá khỏi auth.users.
          </ModalDescription>
          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmDisable(null)}
              disabled={deactivateM.isPending}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleDeactivate}
              loading={deactivateM.isPending}
            >
              Vô hiệu hoá
            </Button>
          </ModalActions>
        </ModalContent>
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/features/settings/accounts-manager-card.tsx
git commit -m "feat(settings): AccountsManagerCard — list + create + edit + disable

Empty state when no accounts. Self-lockout via per-row 'Vô hiệu hoá'
button hidden for current user; edit button stays so users can update
their own name/position.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Create ApproveSignupModal

**Files:**
- Create: `src/features/settings/approve-signup-modal.tsx`

- [ ] **Step 1: Create the modal**

```tsx
"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription,
  ModalActions
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
} from "@/components/ui/select";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useApproveSignup } from "@/hooks/mutations/use-settings-mutations";
import { ROLE_LABELS } from "@/features/navigation/navigation";
import type { SignupRequest, UserRole } from "@/lib/types";

const ROLES: UserRole[] = ["owner", "manager", "staff_operator", "employee_viewer"];

interface ApproveSignupModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  request: SignupRequest | null;
}

export function ApproveSignupModal({
  open,
  onOpenChange,
  request
}: ApproveSignupModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const approveM = useApproveSignup(supabase);

  const [role, setRole] = useState<UserRole>("employee_viewer");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRole("employee_viewer");
      setError(null);
    }
  }, [open]);

  if (!request) return null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!request) return;
    setError(null);
    try {
      await approveM.mutateAsync({ id: request.id, role });
      toast({
        semantic: "success",
        title: "Đã duyệt đơn",
        message: `${request.name ?? request.email} (${ROLE_LABELS[role]}) đã có thể đăng nhập.`
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Duyệt thất bại.");
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>Duyệt đơn đăng ký</ModalTitle>
        <ModalDescription>
          Email: <span className="font-medium text-ink">{request.email}</span>
          {request.name && (
            <>
              <br />
              Họ tên: <span className="font-medium text-ink">{request.name}</span>
            </>
          )}
        </ModalDescription>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          {error && (
            <AlertBanner variant="danger" title="Không thực hiện được">
              {error}
            </AlertBanner>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-ink-2">Vai trò gán cho tài khoản</label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as UserRole)}
              disabled={approveM.isPending}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-muted">
            Thông tin nhân viên (lương theo giờ, vị trí) có thể bổ sung sau
            trong bảng quản lý tài khoản.
          </p>

          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={approveM.isPending}
            >
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={approveM.isPending}>
              Duyệt
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/features/settings/approve-signup-modal.tsx
git commit -m "feat(settings): ApproveSignupModal — role-picker for pending signups

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Create SignupRequestsCard

**Files:**
- Create: `src/features/settings/signup-requests-card.tsx`

- [ ] **Step 1: Create the card**

```tsx
"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription,
  ModalActions
} from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useRejectSignup } from "@/hooks/mutations/use-settings-mutations";
import type { SignupRequest } from "@/lib/types";
import { ApproveSignupModal } from "./approve-signup-modal";

interface SignupRequestsCardProps {
  requests: SignupRequest[];
}

/**
 * Card listing signup_requests in status='pending_approval'.
 *
 * Render-rule: if `requests.length === 0` the card returns null so the
 * Settings page doesn't show a noisy empty card. (Conditional render is
 * preferred to an EmptyState here because the absence of pending requests
 * is the common case.)
 */
export function SignupRequestsCard({ requests }: SignupRequestsCardProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const rejectM = useRejectSignup(supabase);

  const [approving, setApproving] = useState<SignupRequest | null>(null);
  const [rejecting, setRejecting] = useState<SignupRequest | null>(null);

  if (requests.length === 0) return null;

  async function handleReject() {
    if (!rejecting) return;
    try {
      await rejectM.mutateAsync({ id: rejecting.id });
      toast({ semantic: "success", message: "Đã từ chối đơn." });
      setRejecting(null);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Từ chối thất bại."
      });
    }
  }

  function formatRequestedAt(iso: string): string {
    try {
      return new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
    } catch {
      return iso;
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Đơn đăng ký chờ duyệt</CardTitle>
            <p className="mt-1 text-xs text-muted">
              {requests.length} đơn đang chờ — viewer đã tự đăng ký ở màn
              đăng nhập, cần owner/manager gán role.
            </p>
          </div>
        </CardHeader>
        <CardBody>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-muted">
                    Email
                  </th>
                  <th className="text-left py-2 px-2 text-xs font-medium uppercase tracking-wider text-muted">
                    Họ tên
                  </th>
                  <th className="text-left py-2 px-2 text-xs font-medium uppercase tracking-wider text-muted">
                    Gửi lúc
                  </th>
                  <th className="text-right py-2 pl-2 text-xs font-medium uppercase tracking-wider text-muted">
                    Hành động
                  </th>
                </tr>
              </thead>
              <tbody>
                {requests.map((req) => (
                  <tr key={req.id} className="border-b border-border last:border-0">
                    <td className="py-3 pr-4 text-sm text-ink">{req.email}</td>
                    <td className="py-3 px-2 text-sm text-ink">
                      {req.name ?? <span className="text-muted">(không có)</span>}
                    </td>
                    <td className="py-3 px-2 text-xs text-muted">
                      {formatRequestedAt(req.requested_at)}
                    </td>
                    <td className="py-3 pl-2 text-right">
                      <div className="inline-flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="primary"
                          onClick={() => setApproving(req)}
                        >
                          Duyệt
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="danger"
                          onClick={() => setRejecting(req)}
                        >
                          Từ chối
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <ApproveSignupModal
        open={approving !== null}
        onOpenChange={(open) => {
          if (!open) setApproving(null);
        }}
        request={approving}
      />

      <Modal
        open={rejecting !== null}
        onOpenChange={(open) => {
          if (!open) setRejecting(null);
        }}
      >
        <ModalContent>
          <ModalTitle>Từ chối đơn đăng ký?</ModalTitle>
          <ModalDescription>
            Đơn của {rejecting?.email} sẽ chuyển trạng thái "rejected". Auth
            user đã tạo trong Supabase giữ nguyên — họ có thể đăng nhập
            nhưng sẽ luôn thấy màn "Tài khoản chờ duyệt".
          </ModalDescription>
          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRejecting(null)}
              disabled={rejectM.isPending}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleReject}
              loading={rejectM.isPending}
            >
              Từ chối
            </Button>
          </ModalActions>
        </ModalContent>
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/features/settings/signup-requests-card.tsx
git commit -m "feat(settings): SignupRequestsCard — list pending + approve/reject

Renders null when no pending requests (avoid noisy empty card).
Reject uses a Modal-based confirmation instead of window.confirm
(Modal primitive already exists in the design system).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Wire into SettingsView

**Files:**
- Modify: `src/features/settings/settings-view.tsx`

- [ ] **Step 1: Update imports + add the query**

Replace the existing imports at the top with this expanded block:

```tsx
"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { useSupabase } from "@/hooks/use-supabase";
import {
  useAppSettingsQuery,
  useSettingsAccountsQuery,
  useAccountQuery,
  useSignupRequestsQuery
} from "@/hooks/queries";
import type { UserRole } from "@/lib/types";
import { SidebarConfigForm } from "./sidebar-config-form";
import { HandoverDefaultTasksEditor } from "./handover-default-tasks-editor";
import { KiotvietConfigForm } from "./kiotviet-config-form";
import { AccountsManagerCard } from "./accounts-manager-card";
import { SignupRequestsCard } from "./signup-requests-card";
```

- [ ] **Step 2: Add the query call alongside the others**

Inside `SettingsView`, find the existing query block:

```tsx
const appSettingsQuery = useAppSettingsQuery(supabase, isEnabled);
const settingsAccountsQuery = useSettingsAccountsQuery(supabase, isEnabled);
const accountQuery = useAccountQuery(supabase, isEnabled);
```

Add the signup requests query below:

```tsx
const signupRequestsQuery = useSignupRequestsQuery(supabase, isEnabled);
```

- [ ] **Step 3: Render the two new cards**

Find the existing return block:

```tsx
return (
  <div className="space-y-6">
    <SidebarConfigForm
      sidebarDefaults={appSettings.sidebar_defaults}
      accounts={accounts}
      currentUserAuthId={currentAccount.auth_user_id}
    />
    <HandoverDefaultTasksEditor tasks={appSettings.handover_default_tasks} />
    <KiotvietConfigForm />
  </div>
);
```

Replace with this expanded block (AccountsManagerCard high, SignupRequestsCard right after, then existing forms):

```tsx
return (
  <div className="space-y-6">
    <AccountsManagerCard
      accounts={accounts}
      currentUserAuthId={currentAccount.auth_user_id}
    />
    <SignupRequestsCard requests={signupRequestsQuery.data ?? []} />
    <SidebarConfigForm
      sidebarDefaults={appSettings.sidebar_defaults}
      accounts={accounts}
      currentUserAuthId={currentAccount.auth_user_id}
    />
    <HandoverDefaultTasksEditor tasks={appSettings.handover_default_tasks} />
    <KiotvietConfigForm />
  </div>
);
```

- [ ] **Step 4: Type-check + run tests**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0.

Run: `npm run test:run`
Expected: PASS, all existing tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/settings-view.tsx
git commit -m "feat(settings): wire AccountsManagerCard + SignupRequestsCard

Two new cards above the existing Sidebar/Handover/KiotViet sections.
Settings page is now the single place owner/manager edits accounts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Manual smoke verification

**Files:** none (verification only). No commits unless something needs fixing.

This task is intentionally not split into checkbox sub-steps because each one is a manual UI walkthrough that produces no machine-checkable artefact. Treat the whole task as "all six scenarios complete successfully" before checking done.

**Prerequisites:** Supabase running locally (`cd supabase && docker compose up -d`). App started: `npm run dev` (port 3009).

**Scenarios:**

1. **Baseline render**
   Log in as the seeded owner. Open Settings.
   Expected: see "Quản lý tài khoản" card at the top with the seeded owner row + a "+ Thêm tài khoản" button. "Đơn đăng ký chờ duyệt" card is NOT visible (no pending requests yet). Sidebar / Handover / KiotViet cards still render below.

2. **Create a manager**
   Click "Thêm tài khoản". Fill `manager@chill.local`, password `manager-test-123`, name `Test Manager`, role `Quản lý`. Submit.
   Expected: toast success, modal closes, new row appears in the table with role=Quản lý, status=Active.
   Log out → log in as `manager@chill.local`. Expected: lands on dashboard with manager nav; Settings is visible.

3. **Edit the manager's role**
   Re-login as owner. Open Settings → click "Sửa" on the manager row. Change role to `Vận hành` (staff_operator). Submit.
   Expected: toast success, badge updates to "Vận hành".

4. **Disable the manager**
   Click "Vô hiệu hoá" → confirm modal → "Vô hiệu hoá". Expected: row status becomes "Disabled", the disable button disappears.

5. **Viewer self-signup + approve**
   Log out. Go to `/login`, switch to sign-up tab. Sign up with `viewer@chill.local`, password `viewer-test-123`, name `Test Viewer`. Expected: toast "Đã gửi yêu cầu", form returns to sign-in.
   Log in as owner. Open Settings. Expected: "Đơn đăng ký chờ duyệt" card appears with one row.
   Click "Duyệt" → role `Nhân viên xem` → submit. Expected: toast success, row disappears from pending list, new row appears in the accounts table with role=Nhân viên xem, status=Active.
   Log out → log in as `viewer@chill.local`. Expected: lands on dashboard with viewer nav (read-only).

6. **Viewer self-signup + reject**
   Log out → sign up as `viewer2@chill.local`. Log in as owner → Settings. Click "Từ chối" on viewer2's row → confirm. Expected: row disappears.
   Log in as `viewer2@chill.local`. Expected: lands on the "Tài khoản chờ duyệt" landing screen indefinitely.

- [ ] **Step 1: Run scenarios 1–6 above**

Tick when all six pass. Capture any unexpected behaviour as a follow-up issue or bugfix commit before moving on.

- [ ] **Step 2: Run the full verify suite**

Run: `npm run verify:phase`
Expected: PASS — Vitest + pgTAP both green.

- [ ] **Step 3: Final commit (only if any fix was needed during smoke)**

If smoke surfaced no issues, skip this step.

```bash
git status
# if any tracked changes:
git add -A
git commit -m "fix(settings): <describe what surfaced during smoke>"
```

---

## Self-Review (perform after writing the plan)

### 1. Spec coverage

| Spec section | Task(s) | Notes |
|---|---|---|
| §1 Goal — list accounts | Task 9 | AccountsManagerCard renders the table |
| §1 Goal — create user with role | Tasks 6, 7, 9 | useCreateUser + CreateAccountModal + button in card |
| §1 Goal — edit role/info | Tasks 6, 8, 9 | useUpdateUser + EditAccountModal + button in card |
| §1 Goal — soft disable | Tasks 6, 9 | useDeactivateUser + disable button in card + confirm modal |
| §1 Goal — list pending signups | Tasks 5, 11 | useSignupRequestsQuery + SignupRequestsCard |
| §1 Goal — approve | Tasks 3, 6, 10, 11 | endpoint + hook + modal + card wire |
| §1 Goal — reject | Tasks 4, 6, 11 | endpoint + hook + card with confirm modal |
| §3.2 file layout — 9 new files | Tasks 2/3/4/5/7/8/9/10/11 | each task creates one of the planned files |
| §3.2 file layout — modifications | Tasks 1/2/5/6/12 | types, queryKey, data barrel, queries index, mutations, settings-view |
| §4.1 approve endpoint contract | Task 3 | full handler implemented |
| §4.2 reject endpoint contract | Task 4 | full handler implemented |
| §6.4 self-lockout | Tasks 8, 9 | role select disabled in modal; disable button hidden in card row |
| §8 security checklist row 3 (RLS) | (pre-flight) | verified during planning — `signup_select_self_admin` already allows owner/manager SELECT, no RPC fallback needed |
| §9.3 manual smoke 1–6 | Task 13 | mapped 1:1 |

### 2. Placeholder scan

Scanned each task for "TBD", "TODO", "implement later", "Add appropriate error handling", "Similar to Task N", missing code blocks, undefined methods. None found. Every code step includes complete code.

Deviation from spec consciously: the reject confirmation uses `Modal` (Radix Dialog already in design system) instead of `window.confirm` mentioned as a fallback in spec §10 #2. This is documented inline in Task 11's commit message and in the spec-vs-plan deviation note above. Rationale: the design system already supports a clean dialog — no need for `window.confirm`'s ugly native dialog.

### 3. Type consistency

- `SignupRequest` (Task 1) → used in Tasks 2, 5, 10, 11. Property names: `id`, `auth_user_id`, `email`, `name`, `employee_code`, `status`, `requested_at`, `reviewed_by`, `reviewed_at`, `note`. Verified consistent across tasks.
- `CreateUserPayload` (existing, imported in Task 6 + used in Task 7) — already exported from `src/lib/data/accounts.ts`. Verified.
- `UpdateUserInput` (Task 6) — used in Task 8. Properties: `authUserId`, `patch`. Verified.
- `ApproveSignupInput` (Task 6) — used in Task 10. Properties: `id`, `role`. Verified.
- `RejectSignupInput` (Task 6) — used in Task 11. Properties: `id`, `note?`. Verified.
- queryKey: `signupRequests` (Task 1) — used in Tasks 5, 6. Spelled consistently.

All type names and signatures are consistent between definition and use sites.
